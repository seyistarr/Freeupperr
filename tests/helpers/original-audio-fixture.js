// Original synthetic waveform created solely for this test. No samples or
// third-party recordings; no catalogue/licensed entitlement is provisioned.
export function originalAudioWav(){
 const rate=16000,count=rate*8,data=Buffer.alloc(44+count*2);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*2,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(count*2,40);
 for(let i=0;i<count;i++)data.writeInt16LE(Math.round(1200*Math.sin(2*Math.PI*330*i/rate)),44+i*2);
 return data;
}
