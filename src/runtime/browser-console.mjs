// Where ABAP WRITE output goes.
//
// The transpiler runtime creates its console before anything the playground
// controls runs, and its default writes to process.stdout - which is a
// ReferenceError in a browser, thrown from inside a class constructor during
// boot (open-abap's cl_abap_typedescr WRITEs a "todo" while building its type
// cache, long before any application code exists).
//
// The build resolves the runtime's own standard-out console module to this file,
// so the default is an in-memory buffer instead. Same shape as the runtime's
// MemoryConsole - swapping the class in later would not have helped, because the
// first write happens before there is anywhere to swap it from.
export class StandardOutConsole {
  data = "";

  clear() {
    this.data = "";
  }

  add(data) {
    this.data = this.data + data;
  }

  get() {
    return this.data;
  }

  isEmpty() {
    return this.data === "";
  }

  getTrimmed() {
    return this.data.split("\n").map((a) => a.trimEnd()).join("\n");
  }
}
