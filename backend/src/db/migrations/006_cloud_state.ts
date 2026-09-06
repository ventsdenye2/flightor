import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    create table user_identities (
      id bigint generated always as identity primary key,
      user_id bigint not null references users(id) on delete cascade,
      provider text not null,
      provider_subject text not null,
      created_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      unique (provider, provider_subject)
    );
    create index user_identities_user_provider_idx on user_identities (user_id, provider);

    insert into user_identities (user_id, provider, provider_subject, created_at, last_seen_at)
    select id, 'wechat', wechat_openid, created_at, last_login_at
    from users
    on conflict (provider, provider_subject) do nothing;

    create table trips (
      id bigint generated always as identity primary key,
      public_id uuid not null unique,
      user_id bigint not null references users(id) on delete cascade,
      title text not null default '',
      status text not null default 'planning' check (status in ('planning', 'generated', 'archived')),
      current_context_version integer not null default 0 check (current_context_version >= 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index trips_user_updated_idx on trips (user_id, updated_at desc);

    create table trip_context_versions (
      id bigint generated always as identity primary key,
      trip_id bigint not null references trips(id) on delete cascade,
      version integer not null check (version >= 0),
      context_json jsonb not null,
      created_at timestamptz not null default now(),
      unique (trip_id, version)
    );
    create index trip_context_versions_trip_created_idx on trip_context_versions (trip_id, created_at desc);

    create table conversations (
      id bigint generated always as identity primary key,
      public_id uuid not null unique,
      user_id bigint not null references users(id) on delete cascade,
      trip_id bigint not null references trips(id) on delete cascade,
      title text not null default '',
      status text not null default 'active' check (status in ('active', 'archived')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index conversations_user_trip_updated_idx on conversations (user_id, trip_id, updated_at desc);

    create table conversation_messages (
      id bigint generated always as identity primary key,
      public_id uuid not null unique,
      conversation_id bigint not null references conversations(id) on delete cascade,
      role text not null check (role in ('system', 'user', 'assistant', 'tool')),
      content text not null,
      metadata_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create index conversation_messages_conversation_order_idx on conversation_messages (conversation_id, id);

    create table artifacts (
      id bigint generated always as identity primary key,
      public_id uuid not null unique,
      user_id bigint not null references users(id) on delete cascade,
      trip_id bigint not null references trips(id) on delete cascade,
      conversation_id bigint references conversations(id) on delete set null,
      type text not null,
      schema_version integer not null check (schema_version > 0),
      payload_json jsonb not null,
      verification_json jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index artifacts_user_trip_created_idx on artifacts (user_id, trip_id, created_at desc);
    create index artifacts_conversation_idx on artifacts (conversation_id) where conversation_id is not null;
    create index artifacts_type_created_idx on artifacts (type, created_at desc);

    create table user_memories (
      user_id bigint primary key references users(id) on delete cascade,
      enabled boolean not null default true,
      markdown text not null default '',
      version integer not null default 0 check (version >= 0),
      parse_version integer not null default 1 check (parse_version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    insert into user_memories (user_id)
    select id from users
    on conflict (user_id) do nothing;
  `).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
    drop table if exists user_memories;
    drop table if exists artifacts;
    drop table if exists conversation_messages;
    drop table if exists conversations;
    drop table if exists trip_context_versions;
    drop table if exists trips;
    drop table if exists user_identities;
  `).execute(db)
}
