#!/usr/bin/env python3
"""Deprecated command alias for the client-only portrait importer.

The historical video crop pipeline violated the project's client-only art rule.
Use --client with import_dnf_portraits.py; --video is intentionally unsupported.
"""
from import_dnf_portraits import main
if __name__=='__main__':main()
