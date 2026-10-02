import {it,expect} from 'vitest';
import {DiagnosticStateMachine} from '../../src/state/measurementStateMachine';
it('diagnostics lifecycle: permission -> check -> pause -> restart',()=>{
  const s=new DiagnosticStateMachine();expect(s.state).toBe('BOOT');s.send('START');s.send('GRANTED');expect(s.state).toBe('SENSOR_CHECK');s.send('STOP');s.send('START');s.send('FAILED');expect(s.state).toBe('SENSOR_ERROR');s.send('START');expect(s.state).toBe('PERMISSION');
});
it('no accidental progression past hardware review gate',()=>{
  const s=new DiagnosticStateMachine();expect(()=>s.send('GRANTED')).toThrow();s.send('START');s.send('GRANTED');expect(()=>s.send('GRANTED')).toThrow();
});
