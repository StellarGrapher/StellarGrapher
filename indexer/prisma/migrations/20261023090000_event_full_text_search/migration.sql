-- Full-text search over decoded event topics and data values.
ALTER TABLE "ContractEventRecord" ADD COLUMN "search_vector" tsvector;

-- The decoded topic is a JSON array of display strings; the value is already a
-- display string. Both are flattened into one document so a query matches
-- either. `simple` keeps addresses, hashes and symbols intact (no stemming).
CREATE FUNCTION "ContractEventRecord_search_vector_update"() RETURNS trigger AS $$
BEGIN
  NEW."search_vector" :=
    setweight(to_tsvector('simple', coalesce(NEW."topic"::text, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW."value", '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ContractEventRecord_search_vector_trigger"
BEFORE INSERT OR UPDATE OF "topic", "value" ON "ContractEventRecord"
FOR EACH ROW EXECUTE FUNCTION "ContractEventRecord_search_vector_update"();

-- Backfill rows written before the column existed.
UPDATE "ContractEventRecord"
SET "search_vector" =
  setweight(to_tsvector('simple', coalesce("topic"::text, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce("value", '')), 'B');

CREATE INDEX "ContractEventRecord_search_vector_idx"
  ON "ContractEventRecord" USING GIN ("search_vector");
