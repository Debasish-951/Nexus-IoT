# Installing for a New Company

How to give a company its own private installation. Follow it together with
[vm-deployment-checklist.md](vm-deployment-checklist.md), which covers the server setup.

## The rule: one company, one installation

Never put two companies on one installation. The application has no separation between
companies inside a database: every asset, reading and user sits together, and a Company
Admin can see all of it.

Each company gets its own:

| Item | Why |
|---|---|
| Server | A fault or break-in stays within one company |
| Database and database user | One company's login cannot read another's data |
| Web address and TLS certificate | Browser cookies are never shared between companies |
| Passwords and encryption keys | A leaked key exposes only one company |
| Backups | One company's data can be restored or deleted without touching another's |
| Groq key, if AI Advisor is used | Usage and data agreements stay with that company |

## Who has which role

| Role | Who | Created by |
|---|---|---|
| Super Admin | Your support person | The bootstrap command in step 4 |
| Company Admin | The company's main administrator | Super Admin |
| Admin, Engineer, Operator, Viewer | The company's own staff | Company Admin or Super Admin |

A Company Admin cannot edit, suspend or delete a Super Admin, and cannot create another
Company Admin. If theirs leaves the company, the Super Admin creates the replacement.

## Steps

### 1. Generate the settings

Run this on your own computer, from the repository:

```bash
node scripts/new-company-install.mjs --company "Acme Textiles" --domain iot.acme.com
```

This creates `.env` and `create-database.sql` in `../company-installs/acme_textiles/`,
outside the repository. All passwords and keys in them are new and unique. Keep the folder
in your password manager or secure vault, and do not email it.

### 2. Fill in email settings

Set the `SMTP_*` values in `.env`. The API refuses to start until `SMTP_HOST` is set.

### 3. Set up the server

Follow [vm-deployment-checklist.md](vm-deployment-checklist.md), using the generated `.env`.
Before its database step, create the database on this company's server:

```bash
psql -U postgres -f create-database.sql
```

Do not run the `seed` command. It creates sample users and sample data.

### 4. Create your Super Admin

```bash
pnpm --filter @workspace/db run bootstrap -- --user support@yourcompany.com --name "Support" --create --apply
```

The command prints a single-use activation link. Open it and set a password that you use
for this company only.

### 5. Hand over to the company

1. Sign in as Super Admin and open Users.
2. Create the company's administrator with the role **Company Admin**.
3. They receive an activation email and choose their own password.

### 6. Check it

- [ ] The site opens only over `https://` at the company's web address.
- [ ] The Company Admin can sign in and open the Security Center.
- [ ] The API start-up log does not report that `SECRETS_ENC_KEY` is not set.
- [ ] A backup has been restored successfully at least once.

## Privacy checklist

- [ ] **Tell the company you have access.** Your Super Admin can see their data, so state
      this in the contract. They can see your sign-ins in their Security Center.
- [ ] **Leave AI Advisor off** unless the company agrees. When on, it sends asset names,
      metric names, readings and questions to Groq. It is off while `GROQ_API_KEY` is
      unset. Each user can only make it look up data from modules they can open (alarm
      lookups need Alarms, for example), and each question is written to the Activity
      Log as "sent to Groq" with the lookups it made, not the question text. Questions
      are capped at 2,000 characters and 20 per user per 10 minutes (`AI_RL_MAX`,
      `AI_RL_WINDOW_MINUTES`).
- [ ] **Encrypt the server disk and backups.** The application does not encrypt telemetry
      in the database.
- [ ] **Limit database access.** Allow connections only from this company's server.
- [ ] **Remove your access when support ends.** A Company Admin cannot do this for you,
      so suspend your Super Admin account yourself.
- [ ] **Agree what happens when the contract ends:** export their data, then delete the
      server, database and backups.

## Known gaps

- **No two-step login.** The database has fields for it, but login does not use them. Until
  it is built, use long unique passwords, especially for Super Admin.
- **No company separation inside one database.** Sharing a server would need this to be
  built into every query and screen.
- **Updates are per server.** Each installation must be updated on its own.
