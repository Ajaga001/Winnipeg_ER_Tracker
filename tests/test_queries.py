from pathlib import Path

ROOT = Path(__file__).parent.parent


def normalized(path):
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


def test_analysis_migration_matches_queries():
    migration = normalized(ROOT / "migrations" / "005_analysis_views.sql")

    for query in sorted((ROOT / "queries").glob("0*.sql")):
        assert normalized(query) in migration, f"{query.name} has drifted from migration 005"
