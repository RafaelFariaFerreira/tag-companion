import { describe, expect, it } from 'vitest';
import { maskObjectDeep, maskPiiString, maskUrl } from '@/core/pii';
import { exportSession } from '@/core/exporter';
import {
  createTabSession,
  recordCookie,
  recordNetworkRequest,
  recordPageObserverEvent,
} from '@/core/session-store';

describe('PII Masking & Session Exporter', () => {
  it('masks plain emails, formatted phones, and hashed user-data parameters', () => {
    expect(maskPiiString('alice@example.com')).toBe('al***@example.com');
    expect(maskPiiString('+55 (11) 98765-4321')).toBe('***-**21');

    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(maskPiiString(sha256, 'ud[em]')).toBe('sha256:e3b0c4…b855');

    const maskedUrl = maskUrl(
      'https://example.com/thanks?email=bob@company.io&utm_source=google',
    );
    expect(maskedUrl).not.toContain('bob@company.io');
    expect(maskedUrl).toContain('utm_source=google');

    const maskedObj = maskObjectDeep({
      event: 'generate_lead',
      user: { email: 'carol@corp.com', phone: '+1 555-123-4567' },
    });
    expect(maskedObj.user.email).toBe('ca***@corp.com');
    expect(maskedObj.user.phone).toBe('***-**67');
  });

  it('exports session JSON with PII masked by default', () => {
    const t0 = 100_000;
    const session = createTabSession(
      1,
      'https://chargeblast.com/demo?email=secret@user.com',
      true,
      t0,
    );

    recordPageObserverEvent(session, {
      source: 'tag-companion-main',
      type: 'datalayer_push',
      timestamp: t0,
      pageUrl: session.currentUrl,
      payload: {
        data: { event: 'generate_lead', email: 'secret@user.com' },
      },
    });

    recordNetworkRequest(session, {
      requestId: 'r1',
      tabId: 1,
      url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-TEST&en=generate_lead&dl=https%3A%2F%2Fchargeblast.com%2Fdemo%3Femail%3Dsecret%40user.com',
      method: 'POST',
      resourceType: 'ping',
      timestamp: t0 + 100,
      statusCode: 204,
      source: 'devtools',
    });

    recordCookie(session, {
      name: '_fbp',
      value: 'fb.1.1700000000.9988776655',
      domain: '.chargeblast.com',
      path: '/',
      timestamp: t0 + 150,
    });

    const exported = exportSession(session);
    const serialized = JSON.stringify(exported);

    expect(exported.piiMasked).toBe(true);
    expect(serialized).not.toContain('secret@user.com');
    expect(serialized).not.toContain('fb.1.1700000000.9988776655');
    expect(exported.summary.hitsFired).toBe(1);
    expect(exported.summary.dataLayerEvents).toBe(1);
  });
});
