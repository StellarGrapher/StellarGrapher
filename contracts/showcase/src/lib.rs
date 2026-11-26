#![no_std]
//! A Soroban contract whose job is to be *looked at*.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Bytes, Env, Map,
    String, Symbol, Vec,
};

const DAY_IN_LEDGERS: u32 = 17_280;
const PERSISTENT_THRESHOLD: u32 = DAY_IN_LEDGERS * 30;
const PERSISTENT_EXTEND_TO: u32 = DAY_IN_LEDGERS * 90;
const MAX_NOTE_LEN: u32 = 200;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NoteTooLong = 3,
    NoSuchNote = 4,
    Deliberate = 5,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Counter,
    Note(Symbol),
    Values,
    Labels,
    Session(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Note {
    pub author: Address,
    pub body: String,
    pub revision: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Stats {
    pub counter: u32,
    pub admin: Address,
    pub contract: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Initialized {
    #[topic]
    pub admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Bumped {
    pub counter: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NoteWritten {
    #[topic]
    pub name: Symbol,
    #[topic]
    pub author: Address,
    pub revision: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NoteDeleted {
    #[topic]
    pub name: Symbol,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionStarted {
    #[topic]
    pub who: Address,
    pub expires_at: u32,
}

/// A positional payload that exercises the `vec` event data format.
#[contractevent(data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AmountsTallied {
    pub count: u32,
    pub total: i128,
}

/// A bare scalar payload that exercises the `single-value` event data format.
#[contractevent(data_format = "single-value")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CounterValue {
    pub counter: u32,
}

#[contract]
pub struct Showcase;

#[contractimpl]
impl Showcase {
    pub fn init(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Counter, &0u32);
        Initialized {
            admin: admin.clone(),
        }
        .publish(&env);
        Ok(())
    }

    pub fn admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    pub fn bump(env: Env, by: u32) -> u32 {
        let current: u32 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        let next = current.saturating_add(by);
        env.storage().instance().set(&DataKey::Counter, &next);
        env.storage()
            .instance()
            .extend_ttl(PERSISTENT_THRESHOLD, PERSISTENT_EXTEND_TO);
        Bumped { counter: next }.publish(&env);
        CounterValue { counter: next }.publish(&env);
        next
    }

    pub fn put_note(env: Env, author: Address, name: Symbol, body: String) -> Result<u32, Error> {
        author.require_auth();
        if body.len() > MAX_NOTE_LEN {
            return Err(Error::NoteTooLong);
        }

        let key = DataKey::Note(name.clone());
        let revision = match env.storage().persistent().get::<_, Note>(&key) {
            Some(existing) => existing.revision.saturating_add(1),
            None => 1,
        };

        env.storage().persistent().set(
            &key,
            &Note {
                author: author.clone(),
                body,
                revision,
            },
        );
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_EXTEND_TO);
        NoteWritten {
            name,
            author,
            revision,
        }
        .publish(&env);
        Ok(revision)
    }

    pub fn note(env: Env, name: Symbol) -> Result<Note, Error> {
        let key = DataKey::Note(name);
        let note = env
            .storage()
            .persistent()
            .get::<_, Note>(&key)
            .ok_or(Error::NoSuchNote)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_EXTEND_TO);
        Ok(note)
    }

    pub fn delete_note(env: Env, name: Symbol) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        let key = DataKey::Note(name.clone());
        if !env.storage().persistent().has(&key) {
            return Err(Error::NoSuchNote);
        }
        env.storage().persistent().remove(&key);
        NoteDeleted { name }.publish(&env);
        Ok(())
    }

    pub fn start_session(env: Env, who: Address, ledgers: u32) {
        let key = DataKey::Session(who.clone());
        let expires_at = env.ledger().sequence().saturating_add(ledgers.max(1));
        env.storage().temporary().set(&key, &expires_at);
        env.storage()
            .temporary()
            .extend_ttl(&key, ledgers.max(1), ledgers.max(1));
        SessionStarted { who, expires_at }.publish(&env);
    }

    pub fn session(env: Env, who: Address) -> Option<u32> {
        env.storage().temporary().get(&DataKey::Session(who))
    }

    pub fn revisions(env: Env, names: Vec<Symbol>) -> Map<Symbol, u32> {
        let mut out = Map::new(&env);
        for name in names.iter() {
            if let Some(note) = env
                .storage()
                .persistent()
                .get::<_, Note>(&DataKey::Note(name.clone()))
            {
                out.set(name, note.revision);
            }
        }
        out
    }

    /// Store a Vec and a Map as separate persistent entries so Prism's storage
    /// panel has both compound ScVal shapes to render.
    pub fn store_collections(env: Env, values: Vec<i128>, labels: Map<Symbol, String>) {
        let values_key = DataKey::Values;
        let labels_key = DataKey::Labels;
        env.storage().persistent().set(&values_key, &values);
        env.storage().persistent().set(&labels_key, &labels);
        env.storage().persistent().extend_ttl(
            &values_key,
            PERSISTENT_THRESHOLD,
            PERSISTENT_EXTEND_TO,
        );
        env.storage().persistent().extend_ttl(
            &labels_key,
            PERSISTENT_THRESHOLD,
            PERSISTENT_EXTEND_TO,
        );
    }

    pub fn stored_values(env: Env) -> Vec<i128> {
        env.storage()
            .persistent()
            .get(&DataKey::Values)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn stored_labels(env: Env) -> Map<Symbol, String> {
        env.storage()
            .persistent()
            .get(&DataKey::Labels)
            .unwrap_or_else(|| Map::new(&env))
    }

    pub fn tally(env: Env, amounts: Vec<i128>) -> i128 {
        let mut total: i128 = 0;
        for amount in amounts.iter() {
            total = total.saturating_add(amount);
        }
        AmountsTallied {
            count: amounts.len(),
            total,
        }
        .publish(&env);
        total
    }

    pub fn checksum(blob: Bytes) -> u32 {
        let mut acc: u32 = 0;
        for byte in blob.iter() {
            acc ^= byte as u32;
        }
        acc
    }

    pub fn stats(env: Env) -> Result<Stats, Error> {
        Ok(Stats {
            counter: env.storage().instance().get(&DataKey::Counter).unwrap_or(0),
            admin: env
                .storage()
                .instance()
                .get(&DataKey::Admin)
                .ok_or(Error::NotInitialized)?,
            contract: env.current_contract_address(),
        })
    }

    pub fn boom() -> Result<(), Error> {
        Err(Error::Deliberate)
    }
}

mod test;

#[cfg(test)]
mod edge_case_tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events, Ledger},
        vec, Address, Env, String, Symbol, TryFromVal, TryIntoVal,
    };

    fn setup(env: &Env) -> (ShowcaseClient<'static>, Address) {
        env.mock_all_auths();
        let contract_id = env.register(Showcase, ());
        let client = ShowcaseClient::new(env, &contract_id);
        let admin = Address::generate(env);
        client.init(&admin);
        (client, admin)
    }

    /// The deliberately failing entry point must always report `Deliberate`,
    /// whether or not the contract has been initialized.
    #[test]
    fn boom_always_fails_with_deliberate() {
        let env = Env::default();
        let contract_id = env.register(Showcase, ());
        let client = ShowcaseClient::new(&env, &contract_id);
        assert_eq!(client.try_boom(), Err(Ok(Error::Deliberate)));

        let (client, _) = setup(&env);
        assert_eq!(client.try_boom(), Err(Ok(Error::Deliberate)));
    }

    /// Every storage durability and every `DataKey` variant is readable back
    /// through the contract's own accessors.
    #[test]
    fn every_storage_type_round_trips() {
        let env = Env::default();
        let (client, admin) = setup(&env);
        let author = Address::generate(&env);
        let name = Symbol::new(&env, "all");

        // Instance: Admin + Counter.
        assert_eq!(client.admin(), admin);
        assert_eq!(client.bump(&4), 4);
        assert_eq!(client.stats().counter, 4);

        // Persistent: Note, Values, Labels.
        assert_eq!(
            client.put_note(&author, &name, &String::from_str(&env, "body")),
            1
        );
        assert_eq!(client.note(&name).body, String::from_str(&env, "body"));
        let values = vec![&env, -1i128, 0i128, 1i128];
        let mut labels = Map::new(&env);
        labels.set(Symbol::new(&env, "k"), String::from_str(&env, "v"));
        client.store_collections(&values, &labels);
        assert_eq!(client.stored_values(), values);
        assert_eq!(client.stored_labels(), labels);

        // Temporary: Session.
        let who = Address::generate(&env);
        client.start_session(&who, &10);
        assert_eq!(client.session(&who), Some(env.ledger().sequence() + 10));

        // All of it is visible in raw storage under the expected keys.
        env.as_contract(&client.address, || {
            let instance = env.storage().instance();
            assert!(instance.has(&DataKey::Admin));
            assert!(instance.has(&DataKey::Counter));
            let persistent = env.storage().persistent();
            assert!(persistent.has(&DataKey::Note(name.clone())));
            assert!(persistent.has(&DataKey::Values));
            assert!(persistent.has(&DataKey::Labels));
            assert!(env.storage().temporary().has(&DataKey::Session(who)));
        });
    }

    /// `DataKey::Note(name)` must not collide with the other `DataKey`
    /// variants, nor with a note stored under a different name.
    #[test]
    fn storage_keys_do_not_collide() {
        let env = Env::default();
        let (client, _) = setup(&env);
        let author = Address::generate(&env);

        let a = Symbol::new(&env, "a");
        let b = Symbol::new(&env, "b");
        client.put_note(&author, &a, &String::from_str(&env, "first"));
        client.put_note(&author, &b, &String::from_str(&env, "second"));

        // Writing the compound entries leaves the notes untouched.
        client.store_collections(&vec![&env, 1i128], &Map::new(&env));
        assert_eq!(client.note(&a).body, String::from_str(&env, "first"));
        assert_eq!(client.note(&b).body, String::from_str(&env, "second"));

        // Deleting one note does not remove the other.
        client.delete_note(&a);
        assert_eq!(client.try_note(&a), Err(Ok(Error::NoSuchNote)));
        assert_eq!(client.note(&b).body, String::from_str(&env, "second"));

        // The distinct keys really are distinct in raw storage.
        env.as_contract(&client.address, || {
            let persistent = env.storage().persistent();
            assert!(!persistent.has(&DataKey::Note(a)));
            assert!(persistent.has(&DataKey::Note(b)));
            assert!(persistent.has(&DataKey::Values));
            assert!(persistent.has(&DataKey::Labels));
        });
    }

    /// Every event type the contract defines is emitted with the declared
    /// shape, including the empty-data cases.
    #[test]
    fn every_event_type_is_emitted() {
        let env = Env::default();
        let (client, admin) = setup(&env);
        let author = Address::generate(&env);
        let name = Symbol::new(&env, "evt");
        let who = Address::generate(&env);

        // Initialized was published by setup().
        let initialized = Initialized {
            admin: admin.clone(),
        }
        .to_xdr(&env, &client.address);
        assert_eq!(env.events().all().events().first(), Some(&initialized));

        client.bump(&1);
        client.put_note(&author, &name, &String::from_str(&env, "body"));
        client.delete_note(&name);
        client.start_session(&who, &5);
        client.tally(&vec![&env, 1i128, 2i128]);

        let emitted = env.events().all();
        let events = emitted.events();
        let expected = [
            Bumped { counter: 1 }.to_xdr(&env, &client.address),
            CounterValue { counter: 1 }.to_xdr(&env, &client.address),
            NoteWritten {
                name: name.clone(),
                author: author.clone(),
                revision: 1,
            }
            .to_xdr(&env, &client.address),
            NoteDeleted { name: name.clone() }.to_xdr(&env, &client.address),
            SessionStarted {
                who: who.clone(),
                expires_at: env.ledger().sequence() + 5,
            }
            .to_xdr(&env, &client.address),
            AmountsTallied { count: 2, total: 3 }.to_xdr(&env, &client.address),
        ];
        for event in expected.iter() {
            assert!(events.contains(event), "missing event {event:?}");
        }
    }

    /// Events whose payload is empty or zeroed still publish a well-formed
    /// event rather than being skipped.
    #[test]
    fn events_with_empty_data_are_still_published() {
        let env = Env::default();
        let (client, _) = setup(&env);

        // Empty vec payload: count 0, total 0.
        assert_eq!(client.tally(&vec![&env]), 0);
        let expected = AmountsTallied { count: 0, total: 0 }.to_xdr(&env, &client.address);
        assert_eq!(env.events().all().events().last(), Some(&expected));

        // Zero bump: both the struct and the single-value events fire.
        assert_eq!(client.bump(&0), 0);
        let emitted = env.events().all();
        let events = emitted.events();
        assert!(events.contains(&Bumped { counter: 0 }.to_xdr(&env, &client.address)));
        assert!(events.contains(&CounterValue { counter: 0 }.to_xdr(&env, &client.address)));

        // An empty note body is allowed and still emits NoteWritten.
        let author = Address::generate(&env);
        let name = Symbol::new(&env, "empty");
        assert_eq!(
            client.put_note(&author, &name, &String::from_str(&env, "")),
            1
        );
        let expected = NoteWritten {
            name,
            author,
            revision: 1,
        }
        .to_xdr(&env, &client.address);
        assert_eq!(env.events().all().events().last(), Some(&expected));
    }

    /// Sanity check that the raw storage key encoding keeps variants apart.
    #[test]
    fn data_key_encodings_are_distinct() {
        let env = Env::default();
        let a = Symbol::new(&env, "a");
        let b = Symbol::new(&env, "b");
        let keys = [
            DataKey::Admin,
            DataKey::Counter,
            DataKey::Note(a.clone()),
            DataKey::Note(b),
            DataKey::Values,
            DataKey::Labels,
            DataKey::Session(Address::generate(&env)),
        ];
        for (i, left) in keys.iter().enumerate() {
            for right in keys.iter().skip(i + 1) {
                assert_ne!(left, right);
            }
        }
        // Round-trip through the ScVal encoding used for storage.
        let encoded: soroban_sdk::Val = DataKey::Note(a.clone()).try_into_val(&env).unwrap();
        assert_eq!(
            DataKey::try_from_val(&env, &encoded).unwrap(),
            DataKey::Note(a)
        );
    }
}
