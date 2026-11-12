-- Chan UPDATE/DELETE/TRUNCATE tren cac bang bat bien (PostgreSQL).
CREATE FUNCTION ams_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'bang % chi cho phep INSERT (bat bien)', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION ams_forbid_mutation();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION ams_forbid_mutation();
CREATE TRIGGER wallet_entries_immutable BEFORE UPDATE OR DELETE ON wallet_entries FOR EACH ROW EXECUTE FUNCTION ams_forbid_mutation();
CREATE TRIGGER wallet_entries_no_truncate BEFORE TRUNCATE ON wallet_entries FOR EACH STATEMENT EXECUTE FUNCTION ams_forbid_mutation();
CREATE TRIGGER wallet_ledger_immutable BEFORE UPDATE OR DELETE ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION ams_forbid_mutation();
CREATE TRIGGER wallet_ledger_no_truncate BEFORE TRUNCATE ON wallet_ledger FOR EACH STATEMENT EXECUTE FUNCTION ams_forbid_mutation();
