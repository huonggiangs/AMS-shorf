#!/usr/bin/env bash
# JVM self-check for the reference client (stubs only, NOT an Android build). Usage: ./run.sh [http://127.0.0.1:18788]
# Needs JDK 17+ and bcprov (BouncyCastle). BC_JAR can be overridden; Debian/Ubuntu: apt install libbcprov-java.
set -euo pipefail
cd "$(dirname "$0")"
BC_JAR="${BC_JAR:-/usr/share/java/bcprov-1.77.jar}"
rm -rf out && mkdir out
find ../app/src/main/java stubs Check.java -name '*.java' > out/srcs.txt
javac -Xlint:-deprecation -cp "$BC_JAR" -d out @out/srcs.txt
java -cp "out:$BC_JAR" vn.brainrot.parental.tv.Check "$@"
