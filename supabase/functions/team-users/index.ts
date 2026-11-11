import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method tidak didukung." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("Konfigurasi layanan akun belum tersedia.");

    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return reply({ error: "Silakan masuk kembali." }, 401);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return reply({ error: "Sesi tidak valid. Silakan masuk kembali." }, 401);

    const { data: ownerProfile, error: profileError } = await admin.from("profiles")
      .select("id,organization_id,role").eq("id", authData.user.id).maybeSingle();
    if (profileError || !ownerProfile || ownerProfile.role !== "owner") {
      return reply({ error: "Hanya pemilik toko yang boleh mengelola akun." }, 403);
    }

    const body = await req.json();
    const action = String(body?.action || "");
    const organizationId = ownerProfile.organization_id;

    if (action === "list") {
      const [{ data: profiles, error: listError }, { data: authUsers, error: authUsersError }] = await Promise.all([
        admin.from("profiles").select("id,full_name,role,branch_id,created_at").eq("organization_id", organizationId).order("full_name"),
        admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      ]);
      if (listError) throw listError;
      if (authUsersError) throw authUsersError;
      const emails = new Map((authUsers.users || []).map((user) => [user.id, user.email || ""]));
      return reply({ users: (profiles || []).map((profile) => ({ ...profile, email: emails.get(profile.id) || "" })) });
    }

    const branchId = String(body?.branch_id || "");
    if (action !== "delete") {
      const { data: branch, error: branchError } = await admin.from("branches")
        .select("id").eq("id", branchId).eq("organization_id", organizationId).maybeSingle();
      if (branchError) throw branchError;
      if (!branch) return reply({ error: "Pilih cabang toko yang valid." }, 400);
    }

    const allowedRole = (role: unknown) => role === "operator" || role === "technician";
    const fullName = String(body?.full_name || "").trim();
    const email = String(body?.email || "").trim().toLowerCase();
    const password = typeof body?.password === "string" ? body.password : "";
    if (action === "create") {
      if (fullName.length < 2 || fullName.length > 120) return reply({ error: "Nama harus 2–120 karakter." }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: "Format email tidak valid." }, 400);
      if (password.length < 8 || password.length > 128) return reply({ error: "Password harus 8–128 karakter." }, 400);
      if (!allowedRole(body?.role)) return reply({ error: "Pilih role operator atau QC." }, 400);

      // Remove an old invite first so its auth trigger cannot create a duplicate profile.
      const { error: inviteCleanupError } = await admin.from("team_invites").delete()
        .eq("organization_id", organizationId).ilike("email", email);
      if (inviteCleanupError) throw inviteCleanupError;
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName },
      });
      if (createError) throw createError;
      const { error: insertProfileError } = await admin.from("profiles").insert({
        id: created.user.id, organization_id: organizationId, branch_id: branchId,
        full_name: fullName, role: body.role,
      });
      if (insertProfileError) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw insertProfileError;
      }
      return reply({ ok: true, id: created.user.id });
    }

    const targetId = String(body?.id || "");
    const { data: target, error: targetError } = await admin.from("profiles")
      .select("id,role").eq("id", targetId).eq("organization_id", organizationId).maybeSingle();
    if (targetError) throw targetError;
    if (!target) return reply({ error: "Akun tidak ditemukan di toko ini." }, 404);
    if (target.role === "owner") return reply({ error: "Akun pemilik utama tidak dapat diubah atau dihapus dari menu ini." }, 403);

    if (action === "update") {
      if (fullName.length < 2 || fullName.length > 120) return reply({ error: "Nama harus 2–120 karakter." }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: "Format email tidak valid." }, 400);
      if (!allowedRole(body?.role)) return reply({ error: "Pilih role operator atau QC." }, 400);
      if (password && (password.length < 8 || password.length > 128)) return reply({ error: "Password baru harus 8–128 karakter." }, 400);

      const authUpdates: { email?: string; password?: string; email_confirm?: boolean; user_metadata?: Record<string, unknown> } = {
        email, email_confirm: true, user_metadata: { full_name: fullName },
      };
      if (password) authUpdates.password = password;
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(targetId, authUpdates);
      if (authUpdateError) throw authUpdateError;
      const { error: updateProfileError } = await admin.from("profiles").update({
        full_name: fullName, role: body.role, branch_id: branchId,
      }).eq("id", targetId).eq("organization_id", organizationId);
      if (updateProfileError) throw updateProfileError;
      return reply({ ok: true });
    }

    if (action === "delete") {
      const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
      if (deleteError) throw deleteError;
      return reply({ ok: true });
    }

    return reply({ error: "Aksi tidak dikenal." }, 400);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "Permintaan akun gagal diproses." }, 400);
  }
});
