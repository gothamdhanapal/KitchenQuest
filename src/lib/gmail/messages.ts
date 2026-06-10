import "server-only";

import type { gmail_v1 } from "googleapis";

export type GmailOrderMessage = {
  id: string;
  html: string;
  date: Date;
};

export async function searchGmailMessages(
  gmail: gmail_v1.Gmail,
  query: string,
  since?: string | null,
): Promise<string[]> {
  const q = since ? `${query} after:${formatGmailDate(new Date(since))}` : query;
  const response = await gmail.users.messages.list({
    userId: "me",
    q,
    maxResults: 25,
  });

  return response.data.messages?.map((message) => message.id).filter((id): id is string => Boolean(id)) ?? [];
}

export async function getGmailOrderMessage(gmail: gmail_v1.Gmail, messageId: string): Promise<GmailOrderMessage> {
  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const payload = response.data.payload;
  const html = extractMessageBody(payload);
  const dateHeader = payload?.headers?.find((header) => header.name?.toLowerCase() === "date")?.value;

  return {
    id: messageId,
    html,
    date: dateHeader ? new Date(dateHeader) : new Date(Number(response.data.internalDate ?? Date.now())),
  };
}

function extractMessageBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) {
    return "";
  }

  const htmlPart = findPart(payload, "text/html");
  if (htmlPart?.body?.data) {
    return decodeBase64Url(htmlPart.body.data);
  }

  const textPart = findPart(payload, "text/plain");
  if (textPart?.body?.data) {
    return decodeBase64Url(textPart.body.data);
  }

  return payload.body?.data ? decodeBase64Url(payload.body.data) : "";
}

function findPart(
  payload: gmail_v1.Schema$MessagePart,
  mimeType: string,
): gmail_v1.Schema$MessagePart | null {
  if (payload.mimeType === mimeType) {
    return payload;
  }

  for (const part of payload.parts ?? []) {
    const found = findPart(part, mimeType);
    if (found) {
      return found;
    }
  }

  return null;
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function formatGmailDate(date: Date): string {
  return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}
