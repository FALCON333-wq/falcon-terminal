import json, tempfile, unittest
from pathlib import Path
import server

class FalconCoreTests(unittest.TestCase):
    def test_database_schema_and_persistence(self):
        old = server.DB
        with tempfile.TemporaryDirectory() as tmp:
            server.DB = Path(tmp) / "test.db"
            db = server.connect()
            db.execute("INSERT INTO memories(content,created) VALUES(?,?)", ("test memory", server.now()))
            db.commit()
            row = db.execute("SELECT content FROM memories").fetchone()
            self.assertEqual(row["content"], "test memory")
            db.close()
        server.DB = old

    def test_default_config_has_local_ollama(self):
        self.assertTrue(server.OLLAMA.startswith("http://127.0.0.1:") or server.OLLAMA.startswith("http://localhost:"))

if __name__ == "__main__":
    unittest.main()
