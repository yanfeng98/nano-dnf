// Compatibility entry point for measured room42 checks.
process.env.CAPTURE_ROOM="42";
await import("./capture-reference-rooms.mjs");
