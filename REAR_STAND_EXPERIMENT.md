# Rear Stand Compensation — Phase 6 experiment

Default OFF. Enable only in the ?debug=1 diagnostic panel. Physical validation: UNVERIFIED. The formal estimator, displayed needle, formal maxima and Lock-to-Lock are not replaced. The separate core-only MAX gate is intentional in both modes.

## Coordinates and signs

Existing quaternions are Hamilton wxyz, unit, right-hand active rotations: vR=q vD q^-1. Product ab applies b first. qZero maps the device at CENTER to reference/world R; qNow maps the current device to R. Thus qRel=qZero^-1 qNow maps current device vectors to CENTER Z0.

A=normalized calibrated steering axis in Z0, U=normalized zero.upZero in Z0, dot(A,U)>=0. gyroZeroDps=qRel gyroDeviceDps qRel^-1 is angular velocity in Z0. For this experiment both displayed steering theta and body yaw psi are clockwise-positive viewed from gravity up; formal RIGHT is positive, LEFT negative. An explicit invertLeftRight setting negates displayed corrected steering and steering rate alone, not physical body yaw.

Let the upright CENTER vehicle axis in world be Aw=qZero A qZero^-1 and Uw=qZero U qZero^-1. Steering moves the handlebar relative to the vehicle before vehicle yaw moves the whole assembly:

    qNow = Q(Uw,-psi) Q(Aw,-theta) qZero
    qRel = qZero^-1 Q(Uw,-psi) Q(Aw,-theta) qZero
         = Q(U,-psi) Q(A,-theta)

This order follows the existing active convention, not an assumed multiplication convention. The right operand (steering) acts first; yaw then rotates the steering axis with the body. Independent test expectations use Rodrigues matrices in world coordinates, compose body*steer*mount, then multiply mount-transpose to obtain the CENTER matrix and convert that matrix to a quaternion. They do not call the production quaternion generator or optimizer.

## Observability and gyro predictor

    c = dot(A,U); d = max(0,1-c*c)
    separationSin = sqrt(d)
    axisGravityAngleDeg = degrees(acos(clamp(abs(c),0,1)))
    conditionNumber = sqrt((1+abs(c))/(1-abs(c)))

Condition is Infinity when 1-abs(c)<=1e-12; JSON stores the diagnostic string "Infinity" rather than a nonfinite operational number. Provisional separationSin<0.01 is UNOBSERVABLE; condition>20 is ILL_CONDITIONED. Both reject correction. At caster 0, formal LEFT/RIGHT sign remains clear but yaw and steering are indistinguishable. VALID observability means a numerically usable two-axis model, not verified physical accuracy.

Requested fixed-axis approximation omega ~= thetaDotRH*A + psiDotRH*U:

    thetaDotRH = (dot(A,omega)-c*dot(U,omega))/d
    psiDotRH   = (dot(U,omega)-c*dot(A,omega))/d

The RH coefficients are negated for the experiment's clockwise-positive display. No division is performed when observability fails. Physically the instantaneous steering axis is yaw-rotated A, so this fixed-A predictor is an approximation for small vehicle yaw. It is deliberately only a diagnostic/initial seed. No accuracy claim follows from that approximation.

Integrate the previously received split rate only on a new motion timestamp, with actual performance-clock receipt dt, 0<dt<=150ms. Duplicate, negative, zero and excessive dt do not integrate. Orientation and motion are independent event channels. A new orientation sample reseeds both predictor angles from the quaternion fit; cached orientation leaves the corrected angle anchored to its last fit, never a gyro-only estimate. Sample ages beyond the existing 250ms freshness limit reject correction. Raw browser event timestamps remain in Phase 5 diagnostics.

## Bounded quaternion fit and model quality

    qModel(theta,psi) = Q(U,-psi) Q(A,-theta)
    error = normalize(inverse(qModel)*normalize(qObserved))
    e = error with w>=0 (q/-q invariant)
    log residual vector = xyz(e)*2*atan2(norm(xyz(e)),e.w)/norm(xyz(e))
    modelResidualDeg = degrees(norm(log residual vector))

Use its small-angle limit when vector norm approaches zero. Damped two-variable Gauss-Newton minimizes the squared vector norm. Central finite differences give the Jacobian; a 2x2 normal equation and bounded backtracking update the two angles. Initial seed is the previous fit/gyro predictor. No extra library is added. Provisional limits: steering +/-100°, body yaw +/-15°, maximum 24 iterations, maximum 12° step. At or outside search limits, a nonconverged solution is rejected.

Residual <=0.5° is VALID; >0.5° is CHECK; >2° is INVALID. Invalid geometry/sign, missing/stale/nonfinite samples, invalid quaternion, search bound or nonconvergence are INVALID. CHECK/INVALID return null corrected steering and body yaw. Candidate fit parameters remain explicitly diagnostic, alongside rejection reason. A valid model with core CHECK can still be inspected, but cannot certify corrected MAX.

The separate corrected MaxAngleTracker uses compensation VALID + core GOOD, raw gyro norm<=1.5dps, 700ms continuity, angle span<=0.35°, median angle, minimum 3° and update hysteresis 0.20°. Existing confirmed corrected maxima survive temporary CHECK/INVALID; reference loss/new reference invalidates them. Toggling compensation starts a separate experiment. Formal maxima are never written by this object.

## Limits that still require physical comparison

The model assumes extra body rotation is primarily yaw about the CENTER gravity-up direction. Extra out-of-plane roll can raise residual and be rejected; some roll/pitch/slip components can also resemble combinations inside the two-axis model. Small residual cannot prove that fitted psi is true body yaw. Axis calibration contaminated by body movement can produce a wrong A even with acceptable PCA ratio. Numerical condition checks cannot establish physical identifiability in that case.

Use an independently observed steering angle relative to the chassis AND independent chassis yaw relative to the room. Compare front wheel free/supported, front wheel on floor with rear stand, and a securely fixed-chassis reference under the same mounting and calibration protocol. Record repeats on both sides, return-to-center, hold/update, mounting changes, intentional safe small roll/pitch, and core/magnetic statuses. Quantify bias, repeatability, residual behavior and rejection coverage before changing any formal algorithm. All iPhone/Android behavior, actual support/mount effects and thresholds remain unverified.

Pure translation does not directly rotate a quaternion or create angular velocity. This experiment estimates body rotation, not translation, velocity or displacement. Acceleration remains used for gravity and unexpected motion checks. JSON is copied/saved locally; no upload or telemetry is introduced. Phase 7 is not implemented.
