/**
 * Simple password authentication middleware.
 * Uses APP_PASSWORD from env. Session-based.
 */

export function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  if (req.headers.accept?.includes("json")) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.redirect("/login");
}

export function loginHandler(req, res) {
  const { password } = req.body;
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    return res.status(500).json({ error: "APP_PASSWORD not configured" });
  }
  if (password === expected) {
    req.session.authenticated = true;
    return res.redirect("/");
  }
  res.redirect("/login?error=1");
}

export function logoutHandler(req, res) {
  req.session.destroy(() => res.redirect("/login"));
}

export function meHandler(req, res) {
  if (req.session?.authenticated) {
    return res.json({ authenticated: true });
  }
  res.status(401).json({ authenticated: false });
}
