export const ADMIN_EMAILS: string[] = [
  "bryantwardvlogs@gmail.com",
  // TODO: add Sean's email
]

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return ADMIN_EMAILS.includes(email.toLowerCase())
}
