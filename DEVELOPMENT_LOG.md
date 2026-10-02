# Development log

2026-10-02 initial math run: 26/27 passed. Non-unit inverse test used exact object equality and failed at z=-5.55e-17 (IEEE754 rounding). Changed assertion to component tolerance 1e-12; retained test and unchanged mathematical implementation. This is a numerical assertion correction, not deletion of a failing case. Future failures will be recorded and repaired before delivery.

2026-10-02: Phase 2 sequence initially used the preceding segment's velocity at a keyframe, delaying first zero-rate sample by one interval. Changed to the new segment at its left endpoint (piecewise right derivative). Strengthened T11/T12 assertions to exact 2200ms/3500ms, preserving all tests. Q.angle now uses atan2(vector norm, abs(w)) for small-angle numerical stability; convention unchanged.

2026-10-02: UI check found old synthetic buffer could survive a failed physical-start attempt. Clear buffer/display/export preview at every new start so synthetic data is never relabeled physical. Added JSON preview/manual-copy path independent of download support.

2026-10-02: 390/844/1280px layouts passed; 320px had a 2px viewport overflow caused by fixed SVG width/min-content grid sizing. Applied minmax(0,1fr), min-width:0 and responsive SVG width. Recheck before delivery.

2026-10-02 Phase 5: retained all original 90 tests and added asynchronous provenance/consistency/PCA tests. First added run: 102/103 passed. A fixture expecting GYRO_UNAVAILABLE after null gyro also retained a preceding 500ms-old gyro, correctly yielding GYRO_GAP first. Split the null-data portion into a fresh independent stream with a valid predecessor; retained both assertions and unchanged integrator. Added diagnostic-only fallback health and error recovery checks. Final run 105/105 passed, strict TypeScript and Vite build passed.

Phase 5 browser review: synthetic mixed motion shows both PCA candidates; zero-gyro 5° jump shows delta=5, predicted=0, residual=5, ORIENTATION_JUMP without REFERENCE_LOST. JSON copy-field output re-read and parsed (217 and 210 events). PC null sensor events lead to SENSOR_ERROR while captureActive stays true and Stop/Retry remain available. Checked 320/390px with no horizontal overflow. Native iPhone/Android permissions, clipboard and save remain unverified. General publishing steps removed from workflow. No Phase 6 implementation or deployment.
