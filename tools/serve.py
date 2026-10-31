"""Minimal static server for MECHANICAL DAWN with caching disabled.

Usage:  python tools/serve.py [port]      (default port 8765, serves the project root)
Opening index.html directly in a browser also works; this server is only a convenience.
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(NoCacheHandler, directory=root)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"MECHANICAL DAWN: http://127.0.0.1:{port}/")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
