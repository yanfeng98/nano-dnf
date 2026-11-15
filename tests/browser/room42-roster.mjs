// Compatibility entry for the recorded room42 roster checks.
process.env.ROSTER_ROOM='42';
await import('./recorded-roster.mjs');
