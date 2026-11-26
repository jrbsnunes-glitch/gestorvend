declare module 'sql.js' {
  export type SqlValue = string | number | null | Uint8Array;
  export interface Statement {
    bind(values?: SqlValue[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, SqlValue>;
    run(values?: SqlValue[]): void;
    free(): boolean;
  }
  export interface Database {
    run(sql: string, params?: SqlValue[]): Database;
    exec(sql: string): Array<{ columns: string[]; values: SqlValue[][] }>;
    prepare(sql: string): Statement;
    export(): Uint8Array;
  }
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer) => Database;
  }
  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string;
  }): Promise<SqlJsStatic>;
}
