import sys
import unittest
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_DIR))

from server import PageTextParser, SearchResultsParser, choose_research_model, fetch_page


class ResearchParserTests(unittest.TestCase):
    def test_article_publication_metadata_is_extracted(self):
        parser = PageTextParser()
        parser.feed(
            '<html><head><title>Example report</title>'
            '<meta property="article:published_time" content="2026-11-12T09:30:00Z">'
            '</head><body><main><p>Primary article text.</p></main></body></html>'
        )
        self.assertEqual(parser.date, "2026-11-12T09:30:00Z")
        self.assertIn("Example report", " ".join(parser.title_parts))
        self.assertIn("Primary article text.", " ".join(parser.parts))

    def test_time_datetime_is_used_when_meta_date_is_absent(self):
        parser = PageTextParser()
        parser.feed('<html><body><time datetime="2026-11-14">November 14</time></body></html>')
        self.assertEqual(parser.date, "2026-11-14")

    def test_script_and_navigation_text_are_excluded(self):
        parser = PageTextParser()
        parser.feed(
            "<html><body><nav>Navigation noise</nav>"
            "<script>var secret = 'noise';</script>"
            "<main>Useful article paragraph.</main></body></html>"
        )
        extracted = " ".join(parser.parts)
        self.assertIn("Useful article paragraph.", extracted)
        self.assertNotIn("Navigation noise", extracted)
        self.assertNotIn("secret", extracted)

    def test_search_result_parser_pairs_title_and_snippet(self):
        parser = SearchResultsParser()
        parser.feed(
            '<a class="result__a" href="https://example.com/story">Example story</a>'
            '<div class="result__snippet">A useful summary.</div>'
        )
        self.assertEqual(len(parser.results), 1)
        self.assertEqual(parser.results[0]["title"], "Example story")
        self.assertEqual(parser.results[0]["snippet"], "A useful summary.")

    def test_fetch_page_blocks_loopback_ip(self):
        result = fetch_page({
            "title": "Local target",
            "url": "http://127.0.0.1:8765/private",
            "snippet": ""
        })
        self.assertEqual(result["fetch_status"], "blocked")
        self.assertEqual(result["page_text"], "")

    def test_auto_prefers_gemma_for_research(self):
        self.assertEqual(
            choose_research_model("auto", ["qwen3:4b", "gemma3:4b", "llama3.2:latest"]),
            "gemma3:4b"
        )

    def test_qwen_selection_falls_back_to_non_thinking_model(self):
        self.assertEqual(
            choose_research_model("qwen3:4b", ["qwen3:4b", "llama3.2:latest"]),
            "llama3.2:latest"
        )

    def test_qwen_is_not_used_when_it_is_the_only_model(self):
        self.assertIsNone(choose_research_model("qwen3:4b", ["qwen3:4b"]))

    def test_explicit_non_qwen_selection_is_preserved(self):
        self.assertEqual(
            choose_research_model("llama3.2:latest", ["qwen3:4b", "llama3.2:latest"]),
            "llama3.2:latest"
        )


if __name__ == "__main__":
    unittest.main()
