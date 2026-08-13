#!/usr/bin/env python3
"""DART OpenAPI 키 로딩 헬퍼.

키는 소스에 두지 않고 아래 순서로 찾는다.

1. 환경변수 DART_API_KEY  (예: ~/.zshrc 에 export 해 두면 여기서 잡힌다)
2. 리포 루트의 .env       (~/build/true-data/.env, .gitignore 됨)
3. ~/.claude/report-scripts/.env

셋 다 없으면 안내 메시지를 내고 종료한다. 키가 없는 채로 DART 를 호출하면
API 가 인증 오류를 돌려주는데, 그 상태로 파싱을 계속하면 데이터 파일이
빈 값으로 덮여 쓰일 수 있어서 아예 시작 단계에서 막는다.
"""

import os
import sys
from pathlib import Path

ENV_VAR = "DART_API_KEY"
ENV_FILES = [
    Path(__file__).resolve().parent.parent / ".env",
    Path.home() / ".claude" / "report-scripts" / ".env",
]


def _read_env_file(path):
    """KEY=value / export KEY=value 형식을 읽어 dict 로 돌려준다."""
    values = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                if line.startswith("export "):
                    line = line[7:]
                k, v = line.split("=", 1)
                values[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        return {}
    return values


def load_dart_api_key():
    key = os.environ.get(ENV_VAR)
    if key:
        return key

    for path in ENV_FILES:
        if path.exists():
            key = _read_env_file(path).get(ENV_VAR)
            if key:
                return key

    locations = "\n".join(f"  - {p}" for p in ENV_FILES)
    print(
        f"{ENV_VAR} 를 찾을 수 없습니다.\n"
        f"환경변수로 지정하거나 아래 중 한 곳에 {ENV_VAR}=... 를 넣어 주세요.\n"
        f"{locations}\n"
        f"키 발급: https://opendart.fss.or.kr/",
        file=sys.stderr,
    )
    sys.exit(1)
