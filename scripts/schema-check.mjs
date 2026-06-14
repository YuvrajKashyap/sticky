import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const migrationsDir = path.join(root, "supabase", "migrations");

const expectedTables = [
  "allowed_emails",
  "users",
  "user_state",
  "user_preferences",
  "lists",
  "tasks",
  "subtasks",
  "task_recurrence_rules",
  "task_activity",
];

const authenticatedRpcAllowlist = new Set([
  "advance_recurring_task",
  "bootstrap_current_user",
  "clear_completed_tasks",
  "complete_task_with_recurrence",
  "is_active_user",
  "move_task",
  "reorder_lists",
  "reorder_subtasks",
  "reorder_tasks",
  "set_task_completed",
  "undo_recurring_completion",
]);

const requiredHardeningMigration =
  "20260614031937_sticky_harden_security_definer_search_paths.sql";

const failures = [];
const passes = [];

function pass(message) {
  passes.push(message);
  console.log(`PASS ${message}`);
}

function fail(message) {
  failures.push(message);
  console.log(`FAIL ${message}`);
}

function stripLineComments(sql) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function splitStatements(sql) {
  return stripLineComments(sql)
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function rolesFromClause(value) {
  return value
    .split(",")
    .map((role) => role.trim().replace(/"/g, "").toLowerCase())
    .filter(Boolean);
}

function noteCreateFunction(statement, grantsByFunction) {
  const match = statement.match(/\bcreate\s+or\s+replace\s+function\s+sticky\.([a-z_][a-z0-9_]*)\s*\(/i);

  if (!match) {
    return null;
  }

  const functionName = match[1].toLowerCase();

  // Treat every replacement as newly public until a later migration explicitly
  // revokes it. Postgres preserves privileges on replace, but this stricter
  // model keeps future migration authors honest.
  grantsByFunction.set(functionName, new Set(["public"]));

  return functionName;
}

function applyGrantStatement(statement, grantsByFunction) {
  const allRevoke = statement.match(
    /\brevoke\s+execute\s+on\s+all\s+functions\s+in\s+schema\s+sticky\s+from\s+(.+)$/i,
  );

  if (allRevoke) {
    const roles = rolesFromClause(allRevoke[1]);
    for (const grants of grantsByFunction.values()) {
      roles.forEach((role) => grants.delete(role));
    }
    return;
  }

  const allGrant = statement.match(
    /\bgrant\s+execute\s+on\s+all\s+functions\s+in\s+schema\s+sticky\s+to\s+(.+)$/i,
  );

  if (allGrant) {
    const roles = rolesFromClause(allGrant[1]);
    for (const grants of grantsByFunction.values()) {
      roles.forEach((role) => grants.add(role));
    }
    return;
  }

  const functionRevoke = statement.match(
    /\brevoke\s+execute\s+on\s+function\s+sticky\.([a-z_][a-z0-9_]*)\s*\([^)]*\)\s+from\s+(.+)$/i,
  );

  if (functionRevoke) {
    const functionName = functionRevoke[1].toLowerCase();
    const grants = grantsByFunction.get(functionName) ?? new Set();
    rolesFromClause(functionRevoke[2]).forEach((role) => grants.delete(role));
    grantsByFunction.set(functionName, grants);
    return;
  }

  const functionGrant = statement.match(
    /\bgrant\s+execute\s+on\s+function\s+sticky\.([a-z_][a-z0-9_]*)\s*\([^)]*\)\s+to\s+(.+)$/i,
  );

  if (functionGrant) {
    const functionName = functionGrant[1].toLowerCase();
    const grants = grantsByFunction.get(functionName) ?? new Set();
    rolesFromClause(functionGrant[2]).forEach((role) => grants.add(role));
    grantsByFunction.set(functionName, grants);
  }
}

function checkObjectScope(statements) {
  const tableSchemas = new Set();
  const badTables = [];
  const badSchemas = [];
  const grantToAnon = [];

  for (const statement of statements) {
    const createSchema = statement.match(/\bcreate\s+schema(?:\s+if\s+not\s+exists)?\s+([a-z_][a-z0-9_]*)/i);

    if (createSchema && createSchema[1].toLowerCase() !== "sticky") {
      badSchemas.push(createSchema[1]);
    }

    const createTable = statement.match(
      /\bcreate\s+table(?:\s+if\s+not\s+exists)?\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/i,
    );

    if (createTable) {
      const schema = createTable[1].toLowerCase();
      const table = createTable[2].toLowerCase();
      tableSchemas.add(`${schema}.${table}`);

      if (schema !== "sticky") {
        badTables.push(`${schema}.${table}`);
      }
    }

    if (/\bgrant\b/i.test(statement) && /\bto\b[\s\S]*\banon\b/i.test(statement)) {
      grantToAnon.push(statement.replace(/\s+/g, " "));
    }
  }

  if (badSchemas.length) {
    badSchemas.forEach((schema) => fail(`migration creates non-Sticky schema ${schema}`));
  } else {
    pass("migrations only create the Sticky schema");
  }

  if (badTables.length) {
    badTables.forEach((table) => fail(`migration creates table outside sticky.*: ${table}`));
  } else {
    pass("all app tables are created in sticky.*");
  }

  for (const table of expectedTables) {
    if (!tableSchemas.has(`sticky.${table}`)) {
      fail(`missing expected table creation for sticky.${table}`);
    }
  }

  if (expectedTables.every((table) => tableSchemas.has(`sticky.${table}`))) {
    pass("all expected Sticky tables are present in migrations");
  }

  if (grantToAnon.length) {
    grantToAnon.forEach((statement) => fail(`migration grants privileges to anon: ${statement}`));
  } else {
    pass("migrations do not grant Sticky privileges to anon");
  }
}

function checkRls(statements) {
  const sql = statements.join(";\n");
  const missingRls = expectedTables.filter(
    (table) => !new RegExp(`\\balter\\s+table\\s+sticky\\.${table}\\s+enable\\s+row\\s+level\\s+security\\b`, "i").test(sql),
  );

  if (missingRls.length) {
    missingRls.forEach((table) => fail(`missing RLS enablement for sticky.${table}`));
  } else {
    pass("all expected Sticky tables enable RLS");
  }
}

function checkFunctions(statements) {
  const grantsByFunction = new Map();
  const finalFunctionDefinitions = new Map();

  for (const statement of statements) {
    const createdFunction = noteCreateFunction(statement, grantsByFunction);

    if (createdFunction) {
      finalFunctionDefinitions.set(createdFunction, statement);
    }

    applyGrantStatement(statement, grantsByFunction);
  }

  for (const [functionName, statement] of finalFunctionDefinitions) {
    if (/\bsecurity\s+definer\b/i.test(statement) && !/\bset\s+search_path\s*=\s*''/i.test(statement)) {
      fail(`security-definer function sticky.${functionName} does not use search_path = ''`);
    }
  }

  const definerFailures = failures.filter((message) =>
    message.startsWith("security-definer function"),
  );

  if (!definerFailures.length) {
    pass("final security-definer functions use empty pinned search paths");
  }

  const publicOrAnon = [];
  const unexpectedAuthenticated = [];

  for (const [functionName, grants] of [...grantsByFunction.entries()].sort()) {
    if (grants.has("public") || grants.has("anon")) {
      publicOrAnon.push(functionName);
    }

    if (grants.has("authenticated") && !authenticatedRpcAllowlist.has(functionName)) {
      unexpectedAuthenticated.push(functionName);
    }
  }

  if (publicOrAnon.length) {
    publicOrAnon.forEach((functionName) =>
      fail(`final execute grants leave sticky.${functionName} callable by public or anon`),
    );
  } else {
    pass("final execute grants leave no Sticky function callable by public or anon");
  }

  if (unexpectedAuthenticated.length) {
    unexpectedAuthenticated.forEach((functionName) =>
      fail(`sticky.${functionName} is unexpectedly executable by authenticated`),
    );
  } else {
    pass("authenticated RPC execute grants match the Sticky allowlist");
  }
}

async function main() {
  console.log("Sticky schema check");

  const fileNames = (await readdir(migrationsDir))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  if (fileNames.includes(requiredHardeningMigration)) {
    pass(`${requiredHardeningMigration} is present`);
  } else {
    fail(`${requiredHardeningMigration} is missing`);
  }

  const migrations = await Promise.all(
    fileNames.map(async (fileName) => ({
      fileName,
      contents: await readFile(path.join(migrationsDir, fileName), "utf8"),
    })),
  );
  const statements = migrations.flatMap((migration) => splitStatements(migration.contents));

  checkObjectScope(statements);
  checkRls(statements);
  checkFunctions(statements);

  console.log("");
  console.log(`Summary: ${passes.length} passed, ${failures.length} failed`);

  if (failures.length) {
    process.exitCode = 1;
  }
}

await main();
