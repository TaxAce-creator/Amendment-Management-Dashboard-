import "dotenv/config";
import { isAuthorizedTaxAceEmail } from "../server/authorization";
import { createProvisionedUser, getUserByEmail } from "../server/db";

const email = process.argv[2]?.trim().toLowerCase();
const name = process.argv.slice(3).join(" ").trim() || null;

if (!email) {
  console.error("Usage: pnpm user:bootstrap <admin@taxacebsi.com> [Display Name]");
  process.exit(1);
}

if (!isAuthorizedTaxAceEmail(email)) {
  console.error("The bootstrap Admin must use the configured TaxAce Google Workspace domain.");
  process.exit(1);
}

const existing = await getUserByEmail(email);
if (existing) {
  if (existing.role === "Admin" && existing.active) {
    console.log(`Admin ${existing.email} already exists and is active. No bootstrap changes were needed.`);
    process.exit(0);
  }

  console.error(
    `A user already exists for ${email} with role ${existing.role} or inactive status. Use Settings to manage the existing account.`,
  );
  process.exit(1);
}

const created = await createProvisionedUser({ email, name, role: "Admin" });
console.log(`Created Admin ${created?.email}. Google Workspace identity will bind on first successful sign-in.`);
