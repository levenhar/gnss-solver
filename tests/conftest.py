from __future__ import annotations

import shutil

import pytest


@pytest.fixture
def rtklib_available() -> bool:
    return shutil.which("rnx2rtkp") is not None


def pytest_collection_modifyitems(config, items):
    if shutil.which("rnx2rtkp") is not None:
        return
    skip = pytest.mark.skip(reason="rnx2rtkp not on PATH")
    for item in items:
        if "requires_rtklib" in item.keywords:
            item.add_marker(skip)
