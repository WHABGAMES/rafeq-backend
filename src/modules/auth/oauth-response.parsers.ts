export interface SallaOAuthTokens {
  access_token: string;
}

export interface SallaMerchant {
  email?: string;
  name?: string;
  avatar?: string;
  mobile?: string;
  id?: string | number;
  merchant?: string | number;
}

export interface SallaMerchantResponse {
  data?: SallaMerchant;
}

export interface ZidOAuthTokenPayload {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  authorization?: string;
}

export interface ZidMerchantAccount {
  user?: {
    email?: string;
    name?: string;
    mobile?: string;
    id?: string | number;
    store_id?: string | number;
  };
}

export interface GoogleIdentity {
  aud: string;
  email: string;
  sub: string;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const optionalIdentifier = (value: unknown): string | number | undefined =>
  typeof value === 'string' || typeof value === 'number' ? value : undefined;

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`OAuth response is missing ${field}`);
  }
  return value;
};

export const parseGoogleTokenResponse = (value: unknown): string => {
  if (!isRecord(value)) throw new Error('Google token response is invalid');
  return requiredString(value.id_token, 'id_token');
};

export const parseGoogleIdentity = (value: unknown, clientId: string | undefined): GoogleIdentity => {
  if (!isRecord(value)) throw new Error('Google identity response is invalid');

  const issuer = requiredString(value.iss, 'iss');
  if (issuer !== 'accounts.google.com' && issuer !== 'https://accounts.google.com') {
    throw new Error('Google token issuer mismatch');
  }

  const aud = requiredString(value.aud, 'aud');
  if (!clientId || aud !== clientId) throw new Error('Google token audience mismatch');

  if (value.email_verified !== true && value.email_verified !== 'true') {
    throw new Error('Google email is not verified');
  }

  return {
    aud,
    email: requiredString(value.email, 'email'),
    sub: requiredString(value.sub, 'sub'),
    given_name: optionalString(value.given_name),
    family_name: optionalString(value.family_name),
    name: optionalString(value.name),
    picture: optionalString(value.picture),
  };
};

export const parseSallaTokens = (value: unknown): SallaOAuthTokens => {
  if (!isRecord(value)) throw new Error('Salla token response is invalid');
  return { access_token: requiredString(value.access_token, 'access_token') };
};

export const parseSallaMerchant = (value: unknown): SallaMerchantResponse => {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error('Salla merchant response is missing data');
  }

  return {
    data: {
      email: optionalString(value.data.email),
      name: optionalString(value.data.name),
      avatar: optionalString(value.data.avatar),
      mobile: optionalString(value.data.mobile),
      id: optionalIdentifier(value.data.id),
      merchant: optionalIdentifier(value.data.merchant),
    },
  };
};

export const parseZidTokens = (value: unknown): ZidOAuthTokenPayload => {
  if (!isRecord(value)) throw new Error('Zid token response is invalid');

  return {
    access_token: requiredString(value.access_token, 'access_token'),
    refresh_token: requiredString(value.refresh_token, 'refresh_token'),
    expires_in: typeof value.expires_in === 'number' ? value.expires_in : undefined,
    token_type: optionalString(value.token_type),
    authorization: optionalString(value.authorization),
  };
};

export const parseZidMerchant = (value: unknown): ZidMerchantAccount => {
  if (!isRecord(value) || !isRecord(value.user)) {
    throw new Error('Zid merchant response is missing user');
  }

  return {
    user: {
      email: optionalString(value.user.email),
      name: optionalString(value.user.name),
      mobile: optionalString(value.user.mobile),
      id: optionalIdentifier(value.user.id),
      store_id: optionalIdentifier(value.user.store_id),
    },
  };
};
