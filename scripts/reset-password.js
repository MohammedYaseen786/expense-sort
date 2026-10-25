// Usage: npm run reset-password -- you@example.com newpassword
const { get, run } = require("../src/db")
const { hashPassword } = require("../src/auth")

const [email, password] = process.argv.slice(2)
if (!email || !password) {
  console.error("Usage: npm run reset-password -- <email> <new password>")
  process.exit(1)
}
if (password.length < 6) {
  console.error("Password must be at least 6 characters.")
  process.exit(1)
}

const user = get("SELECT id FROM users WHERE email = ?", email.trim().toLowerCase())
if (!user) {
  console.error(`No account found for ${email}.`)
  process.exit(1)
}

run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(password), user.id)
run("DELETE FROM sessions WHERE user_id = ?", user.id)
console.log(`Password updated for ${email}. You can now sign in with the new password.`)
