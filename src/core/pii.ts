const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{4,5}[\s.-]?\d{4}/g;
const SHA256_REGEX = /^[a-f0-9]{64}$/i;

const SENSITIVE_PARAM_PATTERNS = [
  /^em$/i,
  /^ph$/i,
  /^fn$/i,
  /^ln$/i,
  /^ge$/i,
  /^db$/i,
  /^zp$/i,
  /^ct$/i,
  /^st$/i,
  /^ud\[.*\]$/i,
  /^ud\./i,
  /(^|[._-])(email|e_mail|mail|phone|tel|telefone|celular|mobile|cpf|ssn|first_name|last_name|full_name|address|street)($|[._-])/i,
];

export interface PiiFinding {
  type: 'email' | 'phone';
  field: string;
  sample: string;
}

export function isSensitiveParamKey(key: string): boolean {
  return SENSITIVE_PARAM_PATTERNS.some((pattern) => pattern.test(key));
}

export function isHashedValue(value: string): boolean {
  const trimmed = value.trim();
  return SHA256_REGEX.test(trimmed);
}

export function containsPlainEmail(value: string): boolean {
  if (!value) return false;
  EMAIL_REGEX.lastIndex = 0;
  return EMAIL_REGEX.test(decodeSafe(value));
}

export function containsPlainPhone(value: string): boolean {
  if (!value) return false;
  const decoded = decodeSafe(value);
  // Avoid false positives on timestamps, GA client IDs (e.g. 123456789.1700000000), pixel IDs, or UUIDs
  if (/^\d{10,16}(\.\d{10,16})?$/.test(decoded.trim())) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded.trim())) {
    return false;
  }
  const matches = decoded.match(PHONE_REGEX);
  if (!matches) return false;
  return matches.some((m) => {
    const digits = m.replace(/\D/g, '');
    // Require separator or leading + to avoid matching random numeric IDs in URLs
    const hasFormatting = /[+\s().-]/.test(m);
    return digits.length >= 10 && digits.length <= 15 && hasFormatting;
  });
}

export function detectPiiInParams(params: Record<string, string>, url?: string): PiiFinding[] {
  const findings: PiiFinding[] = [];
  const seen = new Set<string>();

  const checkValue = (field: string, raw: string) => {
    if (!raw || isHashedValue(raw)) return;
    const decoded = decodeSafe(raw);

    EMAIL_REGEX.lastIndex = 0;
    const emailMatch = decoded.match(EMAIL_REGEX);
    if (emailMatch) {
      const key = `email:${field}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({ type: 'email', field, sample: maskEmail(emailMatch[0]) });
      }
    }

    // Check phone on URL/page params or explicitly named params
    if (containsPlainPhone(decoded)) {
      const key = `phone:${field}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({ type: 'phone', field, sample: maskPhone(decoded) });
      }
    }
  };

  for (const [k, v] of Object.entries(params)) {
    checkValue(k, v);
  }

  if (url) {
    try {
      const parsed = new URL(url);
      for (const [k, v] of parsed.searchParams.entries()) {
        checkValue(k, v);
      }
      if (parsed.pathname && containsPlainEmail(parsed.pathname)) {
        checkValue('url.path', parsed.pathname);
      }
    } catch {
      checkValue('url', url);
    }
  }

  return findings;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***@***';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

export function maskPhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***-**${digits.slice(-2)}`;
}

export function maskHash(hash: string): string {
  const trimmed = hash.trim();
  if (trimmed.length <= 10) return 'sha256:***' ;
  return `sha256:${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

export function maskPiiString(value: string, key = ''): string {
  if (!value) return value;
  const decoded = decodeSafe(value);

  if (isHashedValue(decoded) && isSensitiveParamKey(key)) {
    return maskHash(decoded);
  }

  let masked = decoded.replace(EMAIL_REGEX, (m) => maskEmail(m));

  if (isSensitiveParamKey(key)) {
    if (masked === decoded) {
      if (isHashedValue(decoded)) return maskHash(decoded);
      if (decoded.replace(/\D/g, '').length >= 7) return maskPhone(decoded);
      if (decoded.length > 2) return `${decoded[0]}***`;
      return '***';
    }
  } else if (containsPlainPhone(masked)) {
    masked = masked.replace(PHONE_REGEX, (m) => {
      const digits = m.replace(/\D/g, '');
      const hasFormatting = /[+\s().-]/.test(m);
      if (digits.length >= 10 && digits.length <= 15 && hasFormatting) {
        return maskPhone(m);
      }
      return m;
    });
  }

  return masked;
}

export function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const maskedSearch = new URLSearchParams();
    for (const [k, v] of parsed.searchParams.entries()) {
      maskedSearch.append(k, maskPiiString(v, k));
    }
    parsed.search = maskedSearch.toString();
    return parsed.toString();
  } catch {
    return maskPiiString(url);
  }
}

export function maskObjectDeep<T>(input: T, parentKey = ''): T {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return maskPiiString(input, parentKey) as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => maskObjectDeep(item, parentKey)) as unknown as T;
  }
  if (typeof input === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      result[k] = maskObjectDeep(v, k);
    }
    return result as T;
  }
  return input;
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
