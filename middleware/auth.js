/**
 * Auth middleware — no-op.
 *
 * Bonaparte runs on localhost only and doesn't expose itself to the network,
 * so there's no login wall. Handlers are kept so server.js and the UI don't
 * need to change; meHandler always reports authenticated, loginHandler just
 * redirects home, logoutHandler clears any residual session and redirects home.
 */

export function requireAuth(_req, _res, next) {
  next();
}

export function loginHandler(_req, res) {
  res.redirect("/");
}

export function logoutHandler(req, res) {
  if (req.session) {
    req.session.destroy(() => res.redirect("/"));
  } else {
    res.redirect("/");
  }
}

export function meHandler(_req, res) {
  res.json({ authenticated: true });
}
