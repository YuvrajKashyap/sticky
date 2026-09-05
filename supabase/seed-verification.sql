-- Local verification only, never a production migration.
-- The historical exposure migration lists other apps in the shared hosted
-- project. This disposable instance contains only Sticky and system schemas.
alter role authenticator set pgrst.db_schemas = 'public,graphql_public,sticky';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
