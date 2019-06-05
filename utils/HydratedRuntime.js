
const OP = require('./constants');
const OffchainStepper = require('./OffchainStepper');
const Merkelizer = require('./Merkelizer');

const toHex = arr => arr.map(e => '0x' + e.toString(16).padStart(64, '0'));

const OP_SWAP1 = parseInt(OP.SWAP1, 16);
const OP_SWAP16 = parseInt(OP.SWAP16, 16);
const OP_DUP1 = parseInt(OP.DUP1, 16);
const OP_DUP16 = parseInt(OP.DUP16, 16);

module.exports = class HydratedRuntime extends OffchainStepper {
  async runNextStep (runState) {
    runState.steps = runState.steps || [];

    const prevStep = runState.steps[runState.steps.length - 1] || {};
    let stack = runState.lastStack || toHex(runState.stack);
    let pc = runState.programCounter;

    const memProof = runState.memProof;
    const callDataProof = runState.callDataProof;
    const gasLeft = runState.gasLeft.addn(0);

    callDataProof.reset();
    memProof.reset();

    await super.runNextStep(runState);

    const opcode = runState.opCode;
    let stackIn = runState.stackIn | 0;

    if (opcode >= OP_SWAP1 && opcode <= OP_SWAP16) {
      stackIn = (16 - (OP_SWAP16 - opcode)) * 2;
    }

    if (opcode >= OP_DUP1 && opcode <= OP_DUP16) {
      stackIn = 16 - (OP_DUP16 - opcode);
    }

    // if we have no errors and opcode is not RETURN or STOP, update pc
    if (runState.errno === 0 && (opcode !== 0xf3 && opcode !== 0x00)) {
      pc = runState.programCounter;
    }

    const gasFee = gasLeft.sub(runState.gasLeft).toNumber();
    const compactStack = stackIn === 0 ? [] : stack.slice(-stackIn);
    const returnData = '0x' + (runState.returnValue ? runState.returnValue.toString('hex') : '');

    let isMemoryRequired = false;
    if (memProof.readHigh !== -1 || memProof.writeHigh !== -1) {
      isMemoryRequired = true;
    }

    let isCallDataRequired = false;
    if (callDataProof.readHigh !== -1 || callDataProof.writeHigh !== -1) {
      isCallDataRequired = true;
    }

    let mem = prevStep.mem;
    const memSize = runState.memoryWordCount.toNumber();
    // serialize the memory if it changed
    if (isMemoryRequired || !prevStep.mem || prevStep.mem.length !== memSize) {
      mem = [];

      const memStore = runState.memProof.data;
      let i = 0;
      while (i < memStore.length) {
        const hexVal = Buffer.from(memStore.slice(i, i += 32)).toString('hex');
        mem.push('0x' + hexVal.padEnd(64, '0'));
      }
      // fill the remaing zero slots
      while (mem.length < memSize) {
        mem.push(OP.ZERO_HASH);
      }
    }

    const compactStackHash = Merkelizer.stackHash(
      stack.slice(0, stack.length - compactStack.length)
    );

    stack = toHex(runState.stack);
    runState.lastStack = stack;

    runState.steps.push({
      memReadLow: memProof.readLow,
      memReadHigh: memProof.readHigh,
      memWriteLow: memProof.writeLow,
      memWriteHigh: memProof.writeHigh,
      callDataReadLow: callDataProof.readLow,
      callDataReadHigh: callDataProof.readHigh,
      isCallDataRequired: isCallDataRequired,
      isMemoryRequired: isMemoryRequired,
      gasFee: gasFee,
      compactStack: compactStack,
      compactStackHash: compactStackHash,
      stackHash: Merkelizer.stackHash(stack),
      mem: mem,
      returnData: returnData,
      pc: pc,
      errno: runState.errno,
      gasRemaining: runState.gasLeft.toNumber(),
      stackSize: runState.stack.length,
    });
  }

  async run (args) {
    const runState = await super.run(args);

    // a temporay hack for our unit tests :/
    if (runState.steps.length > 0) {
      runState.steps[runState.steps.length - 1].stack = toHex(runState.stack);
    }

    return runState.steps;
  }
};
