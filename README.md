# eFactory Steering Angle Meter

**v0.3.0 / Phase 6 measurement UI. Physical device validation remains unverified.**

Public URL: https://efactory-suzuka.github.io/efactory-steering-angle-meter/
Diagnostics: https://efactory-suzuka.github.io/efactory-steering-angle-meter/?debug=1

## Run and deploy

Node.js 24 / pnpm 11.19.0. Run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm build`, then `pnpm dev`.
GitHub Actions verifies tests and strict TypeScript, builds Vite, and publishes only dist to GitHub Pages from main. Pull requests do not deploy. Pages Source is GitHub Actions; base ./ supports the repository path.
The original 105 tests remain unchanged. Phase 6 adds 37 tests, including T37–T54 and independent event rates, jitter, dropouts, invalidation and incomplete results.

## Formal flow

BOOT → PERMISSION → SENSOR_CHECK → MOUNT_GUIDE → CENTER_WAIT → CENTER_CAPTURE → AXIS_CALIBRATION → MEASURING → RESULT.
Only the user's Finish action enters RESULT. Confirming a MAX does not finish measurement. PAUSED, SENSOR_ERROR and REFERENCE_LOST invalidate existing maxima and require a new reference.
Mount the phone with its physical top toward vehicle forward. The guide uses an SVG phone and forward arrow. Left/right inversion defaults to false.
CENTER captures a stable 700 ms cluster, not the button's instantaneous reading, and stores mean zeroQuaternion, zeroGravityUnit and up/forward/right axes. Motion, excessive full quaternion span, gravity magnitude variation and sample gaps reset stillness.

## Provisional settings and estimation

src/config/measurement.ts contains AxisCalibrationMode (RAW_GYRO / TRANSFORMED_GYRO), invertLeftRight and gravityUpSign. Default TRANSFORMED_GYRO follows the earlier synthetic reference design; it has not been shown superior on iPhone or Android. Raw gravity polarity remains unchanged in diagnostics. The default interpretation of gravity as up is provisional and exchangeable.
Formal calibration uses time-weighted non-centered PCA, the same pca3 primitive as Phase 5, anchored at captured CENTER. Acceptance uses configured sample count, duration, total rotation, PCA ratio, outlier angle and upward-axis projection. Phase 5 A/B diagnostics continue independently with their own diagnostic anchor.
qRel = inverse(qZero) * qNow. Swing/twist decomposition supplies the primary orientation angle. sideScore = dot(rotate(qRel, physicalTop), rightZero) classifies LEFT negative / RIGHT positive independently of instructions.
Gyro is transformed into Z0 and projected onto the steering axis. A complementary filter integrates previously received velocity on real performance-clock intervals and corrects only on new relative orientation samples (tau 250 ms). Abnormal dt does not integrate. DeviceOrientation and DeviceMotion never need to arrive together; browser event timestamps remain separate diagnostics.
Only displayAngleDeg uses the 80 ms gauge smoothing. liveAngleDeg feeds MAX tracking. The SVG range expands from ±60 to ±75 after 58°, and to ±90 after 73°, and does not shrink during a measurement.

## Confirmed maxima and quality

The MAX tracker requires continuous 700 ms stillness, gyro ≤1.5 dps and live angle span ≤0.35°. It uses the median of samples in the latest 700 ms; a bracketing sample proves duration and continuity. Minimum lock angle is 3°, update hysteresis 0.20°. Core quality must be GOOD to certify a MAX. Peaks are debug only. At 30° confirmed then 32° moving, the needle moves while the marker stays at 30° until stillness qualifies again.
LEFT is negative. Lock-to-Lock = confirmedRightMaxDeg − confirmedLeftMaxDeg. Incomplete or invalid maxima display no numeric Lock-to-Lock.
Quality shows axis/swing/gravity/absolute and GOOD/CHECK/RETRY/MAGNETIC. Axis uses a recent gyro PCA; swing and predicted gravity residual use the captured reference. Dynamic acceleration defers gravity evaluation. BAD requires configured hold times; two or more core BAD channels persisting 500 ms trigger REFERENCE_LOST and invalidate maxima. Time gaps cannot count toward fault duration.
Absolute orientation / compass supplies auxiliary quality only. Magnetic anomalies do not stop measurement or feed steering angle; unavailable absolute data allows normal relative measurement. Absolute fallback is preserved diagnostically and is not adopted as the formal relative source.

## Diagnostics and privacy

?debug=1 retains raw Euler, absolute flag, provenance, normalized Quaternion, gyro, gravity, independent event timestamps / previous / Hz / dt / opposite-channel age / gaps, orientation/gyro residual, PCA A/B and freshness. It additionally shows the formal reference, angle, MAX and quality, with per-event phase6 snapshots. JSON copy / Blob save remain local, storing only the latest eight seconds. The current app exports build 0.3.0-phase6, source physical-unverified and physicalValidation UNVERIFIED. Synthetic exports are explicitly marked synthetic; regression tests retain the earlier Phase 5 export default.
No sensor uploads, external analytics, account registration, GPS or external fonts. Raw diagnostic logs, test report JSON and local review screenshots are excluded from the public repository. Shared logs may contain userAgent; the user chooses whether to share them.
Branding and the official site link are configured in src/config/branding.ts. Without a supplied logo, text fallback is displayed.

[DEVICE_TEST_PROTOCOL.md](DEVICE_TEST_PROTOCOL.md) retains the seven-second axis checks and adds formal UI instructions. [SENSOR_SPEC_REVIEW.md](SENSOR_SPEC_REVIEW.md) records the earlier API convention review.

## Unverified limits

Real iPhone/Android permissions, rates, gyro axis/polarity, gravity polarity, relative source availability, holder mounting, compass behavior, clipboard/save and actual vehicle repeatability/accuracy require physical validation. GOOD describes configured consistency checks, not certified measurement accuracy. Same-axis vehicle motion or holder slip may be unobservable from relative pose alone. Thresholds remain experimental. This is not a certified instrument for regulatory conformity, service quality, safety or manufacturer dimensions. No Phase 7 implementation.
