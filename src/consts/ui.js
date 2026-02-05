/**
 * @file src/consts/ui.js
 * @description UI placeholders, templates, and path configurations.
 */

export const DASHBOARD_PLACEHOLDERS = Object.freeze({
  VERSION: "{{VERSION}}",
  ACTIVE_COUNT: "{{ACTIVE_COUNT}}",
  SIGNATURE_BADGE: "{{SIGNATURE_BADGE}}",
});

export const DASHBOARD_TEMPLATE_PATH = "public/index.html";

export const UNAUTHORIZED_HTML_TEMPLATE = `
<!DOCTYPE html>
<html>
  <head><title>Access Restricted</title></head>
  <body>
    <p>Strict Mode enabled.</p>
    <p>{{ERROR_MESSAGE}}</p>
  </body>
</html>
`.trim();
