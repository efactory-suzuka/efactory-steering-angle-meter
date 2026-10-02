# Sensor specification review (2026-10-02)

## Primary sources checked before implementation

- [Latest published W3C Device Orientation and Motion](https://www.w3.org/TR/orientation-event/), Candidate Recommendation Draft 2025-02-12, and [Editor's Draft](https://w3c.github.io/deviceorientation/) (same displayed date when checked).
- [WebKit WebCoreMotionManager.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/ios/WebCoreMotionManager.mm): native xyz rates converted rad/s→deg/s; ZXY attitude conversion.
- [WebKit DeviceMotionClientIOS.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/ios/DeviceMotionClientIOS.mm) and [DeviceMotionData.h](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/DeviceMotionData.h): native x/y/z passed in order to alpha/beta/gamma.
- [Chromium device_motion_event_pump.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/device_orientation/device_motion_event_pump.cc) and [rotation rate class](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/device_orientation/device_motion_event_rotation_rate.cc): gyro x/y/z converted to degrees and passed in alpha/beta/gamma order.
- [Apple DeviceOrientationEvent](https://developer.apple.com/documentation/webkitjs/deviceorientationevent), [DeviceMotionEvent](https://developer.apple.com/documentation/webkitjs/devicemotionevent), [WebKit permission discussion](https://bugs.webkit.org/show_bug.cgi?id=201676), [Chrome relative/absolute orientation change](https://developer.chrome.com/blog/device-orientation-changes).

## Adopted mapping

Device axes: physical right +x, physical top +y, screen outward +z. Device frame stays fixed if display orientation changes.

Orientation alpha/beta/gamma describe intrinsic ZXY angles. rotationRate fields are NOT Euler derivatives. W3C §6.3.2 getters and both engine source paths checked specify rotationRate.alpha=x, beta=y, gamma=z, in deg/s. This is intentionally separate from orientation alpha=z, beta=x, gamma=y. Adapter keeps a raw snapshot alongside normalized rates; physical installed-browser mapping must still be verified with three-axis logs.

## Acceleration polarity is unresolved on actual target devices

W3C stationary face-up example gives +z proper acceleration. WebKit passes userAcceleration+gravity multiplied by g without explicit sign inversion; Core Motion gravity can differ from W3C proper-acceleration convention. A source-path inspection alone does not establish the installed Safari version's observable sign. Therefore raw accelerationIncludingGravity is preserved as reported and marked **RAW_UNVERIFIED_POLARITY**. No up vector or vehicle direction is calculated from live data in the initial diagnostics build. Phase 5 must observe face-up and face-down stationary acceleration, all axes, and reference-q vertical agreement; only then add a documented normalization in Adapter. Do not infer sign from device brand alone.

## Relative vs magnetic

Only relative deviceorientation (`absolute=false`) is eligible for the main orientation. Absolute=true and deviceorientationabsolute feed a separate absoluteQuaternion channel. Absolute-only devices are reported as not ready for the planned measurement; do not silently use magnetic orientation as the main angle. webkitCompassHeading is recorded but not converted to a fabricated full Quaternion. Compass accuracy is diagnostic metadata, not a measurement input. Optional absolute does not block motion permission.

## Permissions / time / lifecycle

Both requestPermission calls start synchronously in the same click before the first await. Request orientation without absolute magnetometer requirement. Require secure context; do not request location. Every source stores its own performance.now arrival time; stale cached fields are omitted. Browser event.timeStamp and interval are recorded for diagnosis but never assumed to be a fixed sampling rate. Arrival time is not a hardware capture timestamp: latency remains a Phase 5 check. Stop listeners on hidden/pagehide; resuming requires a new user action and invalidates diagnostic buffer.

## Limits of verification

Latest source main branches are references, not proof of the installed iPhone/Android implementation. API surface tests with simulated events prove adapter logic only. Physical units/sign, scheduling/skew, quantization, drift, gravity polarity, absolute availability and accuracy remain unverified until real logs. Sensor fusion and error monitors share underlying sensors and are not statistically independent witnesses.

## Phase 5 provenance extension (2026-10-02)

Absolute-only stream availability is now accepted for diagnostics, while formal relative health remains unavailable. Store deviceorientation absolute=true as ABSOLUTE_FALLBACK and deviceorientationabsolute as ABSOLUTE_EVENT, in independent caches. Raw events, source-specific Quaternion deltas and browser/receipt clocks are preserved, including invalid/null samples. No absolute stream is adopted as a formal steering reference.

Gyro prediction uses receipt-time zero-order hold across independent channels; browser event.timeStamp is logged separately. Physical sampling/delivery latency remains unknown. The two PCA candidates use DEVICE_RAW versus DIAGNOSTIC_Z0, with explicit sample ages, anchors and segments. Neither method is selected. No new accuracy claim or final threshold adjustment is made.
