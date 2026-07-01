package main

import (
	"log/slog"
	"os"

	"github.com/dushixiang/next-terminal-clone/server/internal/api"
	"github.com/dushixiang/next-terminal-clone/server/internal/config"
	"github.com/dushixiang/next-terminal-clone/server/internal/store"
)

func main() {
	cfg := config.Load()
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))
	if err := cfg.Validate(); err != nil {
		slog.Error("invalid config", "err", err)
		os.Exit(1)
	}

	s, err := store.Open(cfg)
	if err != nil {
		slog.Error("open store failed", "err", err)
		os.Exit(1)
	}

	e := api.NewRouter(s, cfg)
	slog.Info("server starting", "addr", cfg.Addr, "demoMode", cfg.DemoMode)
	if err := e.Start(cfg.Addr); err != nil {
		slog.Error("server stopped", "err", err)
		os.Exit(1)
	}
}
