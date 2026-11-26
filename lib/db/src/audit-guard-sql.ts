/**
 * The audit log guard: triggers and functions that keep `activity_logs`
 * append-only and its chain consistent. Owner-run DDL:
 *
 *   pnpm --filter @workspace/db run audit-guard [-- --runtime-role <role>] [-- --print]
 *
 * The API never runs this on its own unless its database login owns
 * `activity_logs` (the default single-login install), so an upgrade does not
 * lose the protection the earlier start-up DDL gave. See docs/features/audit-log.md.
 *
 * Kept free of imports so the API can read it without opening a connection.
 */

/** Bumped whenever the SQL below changes; the API compares audit_guard_version() with it. */
export const AUDIT_GUARD_VERSION = 2;

/** pg advisory lock serialising appends to the chain, pruning and backfill (same number as the API). */
export const AUDIT_CHAIN_LOCK = 727_274_001;

export const AUDIT_GUARD_SQL = `
CREATE TABLE IF NOT EXISTS audit_checkpoints (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  seq bigint NOT NULL,
  hash text NOT NULL,
  pruned bigint NOT NULL DEFAULT 0,
  mac text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_checkpoints_kind_idx ON audit_checkpoints (kind, seq);

CREATE OR REPLACE FUNCTION audit_guard_version() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT ${AUDIT_GUARD_VERSION} $$;

-- True when the current role is the owner of activity_logs. Inside the
-- SECURITY DEFINER function audit_prune_upto() the current role is the owner.
CREATE OR REPLACE FUNCTION audit_is_owner() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT pg_get_userbyid(relowner) = current_user FROM pg_class WHERE oid = 'activity_logs'::regclass
$$;

-- UPDATE, DELETE and TRUNCATE on activity_logs.
CREATE OR REPLACE FUNCTION audit_logs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'activity_logs is append-only (TRUNCATE refused)' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- Only audit_prune_upto() deletes: it runs as the owner and marks its own transaction.
    IF audit_is_owner() AND current_setting('audit.pruning', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'activity_logs is append-only (DELETE refused)' USING ERRCODE = '42501';
  END IF;
  -- UPDATE: only the one-time hash backfill, only on rows without a hash, and only the two hash columns.
  IF current_setting('app.audit_maint', true) = 'on' AND OLD.hash IS NULL
     AND (to_jsonb(NEW) - 'hash' - 'prev_hash') = (to_jsonb(OLD) - 'hash' - 'prev_hash') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'activity_logs is append-only (UPDATE refused)' USING ERRCODE = '42501';
END $$;

-- INSERT: a new entry must carry seq and hash, come after the chain head and link to it.
CREATE OR REPLACE FUNCTION audit_logs_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_seq bigint;
  v_hash text;
  v_expected text;
BEGIN
  IF NEW.seq IS NULL OR NEW.hash IS NULL OR NEW.prev_hash IS NULL THEN
    RAISE EXCEPTION 'activity_logs: an entry needs seq, prev_hash and hash' USING ERRCODE = '23502';
  END IF;
  SELECT seq, hash INTO v_seq, v_hash FROM activity_logs WHERE hash IS NOT NULL AND seq IS NOT NULL ORDER BY seq DESC LIMIT 1;
  IF FOUND THEN
    IF NEW.seq <= v_seq THEN
      RAISE EXCEPTION 'activity_logs: entry % is not after the chain head %', NEW.seq, v_seq USING ERRCODE = '23514';
    END IF;
    v_expected := v_hash;
  ELSE
    SELECT hash INTO v_expected FROM audit_checkpoints WHERE kind = 'checkpoint' ORDER BY seq DESC LIMIT 1;
    IF NOT FOUND THEN
      SELECT value->>'hash' INTO v_expected FROM job_state WHERE key = 'audit_checkpoint';
    END IF;
    v_expected := coalesce(v_expected, '');
  END IF;
  IF NEW.prev_hash IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'activity_logs: entry % does not link to the chain head', NEW.seq USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS audit_logs_guard_row ON activity_logs;
CREATE TRIGGER audit_logs_guard_row BEFORE UPDATE OR DELETE ON activity_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_guard();
DROP TRIGGER IF EXISTS audit_logs_guard_truncate ON activity_logs;
CREATE TRIGGER audit_logs_guard_truncate BEFORE TRUNCATE ON activity_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_guard();
DROP TRIGGER IF EXISTS audit_logs_guard_insert ON activity_logs;
CREATE TRIGGER audit_logs_guard_insert BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_insert_guard();

-- audit_checkpoints is insert-only; checkpoints themselves are written only by audit_prune_upto().
CREATE OR REPLACE FUNCTION audit_checkpoints_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind = 'checkpoint' AND NOT audit_is_owner() THEN
      RAISE EXCEPTION 'audit_checkpoints: checkpoints are written by audit_prune_upto() only' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_checkpoints is insert-only (% refused)', TG_OP USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS audit_checkpoints_guard_row ON audit_checkpoints;
CREATE TRIGGER audit_checkpoints_guard_row BEFORE INSERT OR UPDATE OR DELETE ON audit_checkpoints FOR EACH ROW EXECUTE FUNCTION audit_checkpoints_guard();
DROP TRIGGER IF EXISTS audit_checkpoints_guard_truncate ON audit_checkpoints;
CREATE TRIGGER audit_checkpoints_guard_truncate BEFORE TRUNCATE ON audit_checkpoints FOR EACH STATEMENT EXECUTE FUNCTION audit_checkpoints_guard();

-- Retention. Runs as the owner (SECURITY DEFINER), so the runtime login needs no
-- DELETE right. Removes the oldest entries up to and including p_seq, only when
-- every one of them is older than the retention (never under 365 days), and
-- records p_seq/p_hash as the checkpoint the remaining chain starts from.
-- p_mac is the application's HMAC over the checkpoint (null without a key).
CREATE OR REPLACE FUNCTION audit_prune_upto(p_seq bigint, p_hash text, p_days integer, p_mac text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  v_cut timestamptz;
  v_hash text;
  v_newest timestamptz;
  v_prev bigint;
  v_n bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK});
  v_cut := now() - make_interval(days => greatest(coalesce(p_days, 365), 365));
  SELECT coalesce(hash, '') INTO v_hash FROM activity_logs WHERE seq = p_seq;
  IF NOT FOUND OR v_hash IS DISTINCT FROM coalesce(p_hash, '') THEN
    RAISE EXCEPTION 'audit_prune_upto: entry % does not match', p_seq USING ERRCODE = '22023';
  END IF;
  SELECT max("timestamp") INTO v_newest FROM activity_logs WHERE seq <= p_seq;
  IF v_newest >= v_cut THEN
    RAISE EXCEPTION 'audit_prune_upto: entries up to % are not all older than the retention', p_seq USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('audit.pruning', 'on', true);
  DELETE FROM activity_logs WHERE seq <= p_seq;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('audit.pruning', 'off', true);
  SELECT pruned INTO v_prev FROM audit_checkpoints WHERE kind = 'checkpoint' ORDER BY seq DESC LIMIT 1;
  IF v_prev IS NULL THEN
    SELECT (value->>'pruned')::bigint INTO v_prev FROM job_state WHERE key = 'audit_checkpoint';
  END IF;
  INSERT INTO audit_checkpoints (kind, seq, hash, pruned, mac) VALUES ('checkpoint', p_seq, coalesce(p_hash, ''), coalesce(v_prev, 0) + v_n, p_mac);
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION audit_prune_upto(bigint, text, integer, text) FROM PUBLIC;
`;

/**
 * Grants for a separate runtime login (the owner keeps everything). The runtime
 * login may read and append, call audit_prune_upto(), and nothing else on the
 * two audit tables. `job_state` is not revoked: the application upserts its
 * settings and job state there, and nothing in it is trusted by verification
 * any more (checkpoints live in the insert-only audit_checkpoints).
 */
export function auditGuardGrantsSql(role: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(role)) throw new Error(`Not a valid role name: ${role}`);
  const r = `"${role}"`;
  return `
REVOKE UPDATE, DELETE, TRUNCATE ON activity_logs, audit_checkpoints FROM ${r};
GRANT SELECT, INSERT ON activity_logs, audit_checkpoints TO ${r};
GRANT USAGE, SELECT ON SEQUENCE activity_logs_seq, audit_checkpoints_id_seq TO ${r};
GRANT EXECUTE ON FUNCTION audit_prune_upto(bigint, text, integer, text) TO ${r};
`;
}
