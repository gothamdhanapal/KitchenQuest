import { NextRequest, NextResponse } from "next/server";
import {
  type GmailConnectionForIngestion,
  runGmailIngestionForConnections,
} from "@/lib/ingestion/gmail-ingestion";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  const receivedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!expectedSecret || receivedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: connections, error } = await supabase
    .from("gmail_connections")
    .select("id, household_id, user_id, gmail_address, refresh_token_ciphertext, last_checked_at")
    .eq("status", "active");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const summary = await runGmailIngestionForConnections(
    supabase,
    (connections ?? []) as GmailConnectionForIngestion[],
    {
      getSince: (connection) => connection.last_checked_at,
      updateLastChecked: true,
    },
  );

  return NextResponse.json(summary);
}
