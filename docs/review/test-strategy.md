# Test Strategy

**Confidence: Low (aspirational)** — no automated tests currently exist. This document defines the target testing posture.

---

## Current State

**Zero automated tests.** All validation is manual via the browser UI and ad-hoc API calls. This is the most significant quality gap in the platform.

---

## Testing Pyramid

```
         ┌──────────┐
         │  E2E /   │  ← Playwright (browser automation)
         │  UI Tests│     ~20 critical user flow tests
         ├──────────┤
         │Integration│  ← API + DB integration tests
         │  Tests   │     ~50 route-level tests with real DB
         ├──────────┤
         │  Unit    │  ← Vitest (fast, no DB)
         │  Tests   │     ~100 unit tests for pure functions
         └──────────┘
```

---

## Unit Tests (Target: ~100 tests)

**Framework:** Vitest  
**Scope:** Pure functions with no external dependencies  

### Priority Unit Test Targets

| Module | Functions to Test |
|--------|------------------|
| `ingest.ts` — `normalise()` | All 4 payload formats, missing deviceId, empty metrics |
| `ingest.ts` — `evalOp()` | All 6 operators (gt, lt, gte, lte, eq, ne) |
| `ingest.ts` — `evalExpression()` | Valid expressions, invalid syntax, division by zero |
| `apiKeyAuth.ts` — `isRateLimited()` | Within limit, exceeded limit, window reset |
| Data payload normalisation | Nested-data, nested-metrics, flat, nested-root, timestamp formats |
| Alarm deadband logic | Trigger, clear within deadband, clear outside deadband |

### Example Unit Test
```typescript
import { describe, it, expect } from 'vitest';
import { normalise } from '../src/routes/ingest';

describe('normalise()', () => {
  it('extracts nested-data format', () => {
    const result = normalise({
      deviceId: 'sensor-01',
      data: { temperature: 25.3, humidity: 62.1 },
    });
    expect(result?.payloadFormat).toBe('nested-data');
    expect(result?.metrics).toEqual({ temperature: 25.3, humidity: 62.1 });
  });

  it('returns null when deviceId is missing', () => {
    expect(normalise({ data: { temp: 1 } })).toBeNull();
  });
});
```

---

## Integration Tests (Target: ~50 tests)

**Framework:** Vitest + Supertest  
**Database:** Test PostgreSQL database (separate from dev)  
**Scope:** Full request → route → DB → response cycle  

### Priority Integration Test Targets

| Endpoint | Scenarios |
|----------|----------|
| `POST /api/ingest/payload` | Valid payload, missing deviceId, auto-create asset, alarm trigger |
| `POST /api/ingest/validate` | Asset matched, asset not found, invalid format |
| `GET /api/assets` | Returns seeded assets |
| `POST /api/assets` | Creates asset, validates parentId |
| `GET /api/telemetry/:assetId` | Filtered by metric, time range, limit |
| `POST /api/alarm-rules` | Valid rule, invalid operator |
| `POST /api/alarms/:id/acknowledge` | Valid ack, already acknowledged |
| `GET /api/system/storage` | Returns table stats |
| `POST /api/api-clients` + auth | Client created, used for authenticated request |

---

## E2E Tests (Target: ~20 tests)

**Framework:** Playwright  
**Scope:** Critical user flows through the browser  

### Priority E2E Flows

| Flow | Steps |
|------|-------|
| Dashboard loads | Navigate to `/`, verify stat cards render |
| Asset creation | Navigate to `/assets`, create root project, verify in tree |
| Telemetry ingest → dashboard update | POST telemetry, verify dashboard refreshes |
| Alarm acknowledge | Trigger alarm via ingest, navigate to `/alarms`, acknowledge |
| Visualization widget | Create widget, verify chart renders |
| Role switching | Switch to operator, verify admin-only buttons hidden |
| Report download | Navigate to `/reports`, generate telemetry report, verify CSV download |

---

## Coverage Map

| Domain | Unit | Integration | E2E |
|--------|------|-------------|-----|
| Ingest pipeline | High | High | Medium |
| Alarm engine | High | High | Medium |
| Asset CRUD | Low | Medium | High |
| Telemetry query | Low | Medium | Low |
| Auth middleware | High | Medium | Low |
| RBAC enforcement | Low | Low | High |
| WebSocket events | None | Low | Medium |
| Retention pruning | Medium | Low | None |
| Expression engine | High | Low | None |

---

## Test Infrastructure Setup

```bash
# Install test dependencies
pnpm --filter @workspace/api-server add -D vitest supertest @types/supertest

# Configure test database
export TEST_DATABASE_URL="postgresql://localhost:5432/ws_test"

# Run unit tests
pnpm --filter @workspace/api-server run test:unit

# Run integration tests (requires test DB)
pnpm --filter @workspace/api-server run test:integration

# Run E2E tests (requires running app)
pnpm --filter @workspace/iot-platform run test:e2e
```

---

## Testing Gaps (Current)

- No tests of any kind exist
- No test database setup scripts
- No test data seeding utilities
- No CI integration for test execution
