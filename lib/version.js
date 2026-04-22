/**
 * Version + update manifest location. Bumped by scripts/release.js.
 *
 * The update manifest is a tiny JSON file synced into every CN3 A/S user's
 * OneDrive library. No network calls, no auth, no public artifacts.
 *
 *   { "version": "X.Y.Z", "notes": "..." }
 *
 * BonaparteSetup.exe lives next to latest.json in the same folder.
 */
export const VERSION = "3.1.0";

// Relative to os.homedir() — points at the synced SharePoint library.
export const MANIFEST_RELATIVE = "CN3 A S/Bimgenetic - Global - Documents/General/08 Implementation/8.8 Bonaparte";
export const MANIFEST_FILE = "latest.json";
export const INSTALLER_FILE = "BonaparteSetup.exe";
