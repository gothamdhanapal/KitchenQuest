import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

export type UserProfile = {
  id: string;
  household_id: string;
  email: string;
  display_name: string | null;
  role: "owner" | "member";
};

export async function ensureUserProfile(
  supabase: SupabaseClient,
  user: Pick<User, "id" | "email" | "user_metadata">,
): Promise<UserProfile> {
  const { data: existingProfile, error: profileError } = await supabase
    .from("users")
    .select("id, household_id, email, display_name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  if (existingProfile) {
    return existingProfile as UserProfile;
  }

  const { data: household, error: householdError } = await supabase
    .from("households")
    .insert({ name: "FreshLoop Household" })
    .select("id")
    .single();

  if (householdError) {
    throw householdError;
  }

  const displayName =
    typeof user.user_metadata?.name === "string" ? user.user_metadata.name : user.email?.split("@")[0] ?? null;

  const { data: createdProfile, error: createProfileError } = await supabase
    .from("users")
    .insert({
      id: user.id,
      household_id: household.id,
      email: user.email ?? "",
      display_name: displayName,
      role: "owner",
    })
    .select("id, household_id, email, display_name, role")
    .single();

  if (createProfileError) {
    throw createProfileError;
  }

  return createdProfile as UserProfile;
}
