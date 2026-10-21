declare module "@garmin/fitsdk" {
  export class Encoder {
    onMesg(mesgNum: number, data: Record<string, unknown>): void;
    close(): Uint8Array;
  }

  export class Stream {
    static fromByteArray(bytes: Uint8Array | number[]): Stream;
  }
  export class Decoder {
    constructor(stream: Stream);
    read(): { messages: Record<string, any[]>; errors: unknown[] };
  }

  export const Profile: {
    MesgNum: {
      FILE_ID: number;
      WORKOUT: number;
      WORKOUT_STEP: number;
    };
  };
}
