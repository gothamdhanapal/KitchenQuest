import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "");
  const redirectTo = `${process.env.APP_URL ?? new URL(request.url).origin}/auth/callback`;

  if (!email) {
    return NextResponse.redirect(new URL("/?auth=missing_email", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
    },
  });

  if (error) {
    return NextResponse.redirect(new URL("/?auth=sign_in_failed", request.url));
  }

  return NextResponse.redirect(new URL("/?auth=check_email", request.url));
}
