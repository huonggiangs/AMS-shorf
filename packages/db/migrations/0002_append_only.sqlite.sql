-- Chan UPDATE/DELETE tren cac bang bat bien (SQLite/D1).
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'bang audit_log chi cho phep INSERT (bat bien)');
END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'bang audit_log chi cho phep INSERT (bat bien)');
END;
CREATE TRIGGER wallet_entries_no_update BEFORE UPDATE ON wallet_entries
BEGIN
  SELECT RAISE(ABORT, 'bang wallet_entries chi cho phep INSERT (bat bien)');
END;
CREATE TRIGGER wallet_entries_no_delete BEFORE DELETE ON wallet_entries
BEGIN
  SELECT RAISE(ABORT, 'bang wallet_entries chi cho phep INSERT (bat bien)');
END;
CREATE TRIGGER wallet_ledger_no_update BEFORE UPDATE ON wallet_ledger
BEGIN
  SELECT RAISE(ABORT, 'bang wallet_ledger chi cho phep INSERT (bat bien)');
END;
CREATE TRIGGER wallet_ledger_no_delete BEFORE DELETE ON wallet_ledger
BEGIN
  SELECT RAISE(ABORT, 'bang wallet_ledger chi cho phep INSERT (bat bien)');
END;
