-- Expose Sticky's custom schema to Supabase Data API without changing existing app schemas.

alter role authenticator
  set pgrst.db_schemas = 'public, graphql_public, axis, capital, arcade, jasiverse, chronos, why, sticky';

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
