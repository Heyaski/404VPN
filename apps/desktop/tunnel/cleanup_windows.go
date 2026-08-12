//go:build windows

package main

// cleanup только при ошибке CreateTUN — не на каждый Connect.
func cleanupStaleAdapters() {
	// no-op fast path; тяжёлый Remove-PnpDevice убран намеренно
}
