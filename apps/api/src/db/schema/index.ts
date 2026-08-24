/**
 * The whole database, in one namespace.
 *
 * `drizzle-kit` reads this file to diff the schema, and the query client is instantiated
 * with it so relational queries resolve. A table that is not re-exported here does not exist
 * as far as either is concerned.
 */

export * from './catalog';
export * from './content';
export * from './customers';
export * from './orders';
export * from './system';
export * from './wholesale';
