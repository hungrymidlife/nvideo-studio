/** Optimistic volume + one ordered native write at a time. No 500ms poll dependency. */
export class LibmpvVolume{
 value:number;revision=0;pending=false;
 private queued:number|null=null;
 private disposed=false;
 activate(){this.disposed=false;}
 dispose(){this.disposed=true;this.queued=null;}
 private save:(value:number)=>Promise<unknown>;
 private changed:(value:number)=>void;
 private failed:(error:unknown)=>void;
 constructor(initial:number,save:(value:number)=>Promise<unknown>,
   changed:(value:number)=>void,failed:(error:unknown)=>void){
  this.value=initial;this.save=save;this.changed=changed;this.failed=failed;
 }
 set(value:number){
  if(this.disposed||!Number.isFinite(value))return;
  this.value=Math.min(100,Math.max(0,Math.round(value)));this.revision++;
  this.changed(this.value);this.queued=this.value;void this.flush();
 }
 change(delta:number){this.set(this.value+delta);}
 accept(value:number|undefined,revision:number,pendingAtRequest=false){
  if(!pendingAtRequest&&!this.disposed&&revision===this.revision&&!this.pending&&this.queued===null&&Number.isFinite(value))
   this.value=Math.min(100,Math.max(0,value!));
 }
 private async flush(){
  if(this.pending)return;
  this.pending=true;
  try{
   while(!this.disposed&&this.queued!==null){
    const next=this.queued;this.queued=null;
    try{await this.save(next);}catch(error){if(!this.disposed)this.failed(error);}
   }
  }finally{this.pending=false;}
 }
}
