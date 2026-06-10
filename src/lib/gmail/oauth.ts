import "server-only";

import { google } from "googleapis";

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing Google OAuth environment variables.");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function buildGmailOAuthUrl(state: string): string {
  const oauthClient = getOAuthClient();

  return oauthClient.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GMAIL_READONLY_SCOPE],
    state,
  });
}

export async function exchangeGmailOAuthCode(code: string) {
  const oauthClient = getOAuthClient();
  const { tokens } = await oauthClient.getToken(code);
  oauthClient.setCredentials(tokens);

  const gmail = google.gmail({ version: "v1", auth: oauthClient });
  const profile = await gmail.users.getProfile({ userId: "me" });

  return {
    tokens,
    gmailAddress: profile.data.emailAddress,
    historyId: profile.data.historyId,
  };
}

export function createGmailClientFromRefreshToken(refreshToken: string) {
  const oauthClient = getOAuthClient();
  oauthClient.setCredentials({ refresh_token: refreshToken });

  return google.gmail({ version: "v1", auth: oauthClient });
}
