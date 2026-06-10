import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { exchangeGmailOAuthCode } from "@/lib/gmail/oauth";
import { ensureUserProfile } from "@/lib/households";
import { encryptSecret } from "@/lib/security/encryption";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("gmail_oauth_state")?.value;
  const redirectUrl = new URL("/", process.env.APP_URL ?? request.url);

  if (!code || !state || !expectedState || state !== expectedState) {
    redirectUrl.searchParams.set("gmail", "invalid_state");
    return NextResponse.redirect(redirectUrl);
  }

  cookieStore.delete("gmail_oauth_state");

  const userClient = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    redirectUrl.searchParams.set("gmail", "not_authenticated");
    return NextResponse.redirect(redirectUrl);
  }

  const adminClient = createSupabaseAdminClient();
  const profile = await ensureUserProfile(adminClient, user);
  const { tokens, gmailAddress, historyId } = await exchangeGmailOAuthCode(code);

  if (!tokens.refresh_token || !gmailAddress) {
    redirectUrl.searchParams.set("gmail", "missing_refresh_token");
    return NextResponse.redirect(redirectUrl);
  }

  const { error } = await adminClient.from("gmail_connections").upsert(
    {
      household_id: profile.household_id,
      user_id: profile.id,
      gmail_address: gmailAddress,
      refresh_token_ciphertext: encryptSecret(tokens.refresh_token),
      last_history_id: historyId,
      status: "active",
      error_message: null,
    },
    { onConflict: "user_id,gmail_address" },
  );

  if (error) {
    redirectUrl.searchParams.set("gmail", "save_failed");
    return NextResponse.redirect(redirectUrl);
  }

  redirectUrl.searchParams.set("gmail", "connected");
  return NextResponse.redirect(redirectUrl);
}
