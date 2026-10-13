/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import { useState, useEffect } from "react";
import cockpit from "cockpit";

export interface VarConfig {
    name: string;
    value: string;
}

export interface RoleConfig {
    name: string;
    full_name: string;
    description: string;
    vars: VarConfig[];
}

export interface Config {
    roles: RoleConfig[];
}

export class AppConfig {
    #file: cockpit.FileHandle<unknown>;
    #tag: string;

    config: Config;

    constructor (file: cockpit.FileHandle<unknown>, data: unknown, tag: string) {
        this.#file = file;
        this.#tag = tag

        // XXX use json_import
        this.config = data as Config;
    }

    async modify(func: (old: Config) => Config) {
        await this.#file.replace(func(this.config), this.#tag);
    }
}

export const useAppConfig = () => {
    const [config, setConfig] = useState<AppConfig | Error | null>(null);

    useEffect(
        () => {
            const file: cockpit.FileHandle<unknown> = cockpit.file(
                "/etc/cockpit/system-roles.json",
                { syntax: JSON, superuser: "try" }
            );

            file.watch(
                (data, tag, error) => {
                    console.log("CONF", data);
                    if (error)
                        setConfig(new Error(error.message));
                    else {
                        cockpit.assert(tag);
                        if (data)
                            setConfig(new AppConfig(file, data, tag));
                        else
                            setConfig(new AppConfig(file, { roles: [] }, tag));
                    }
                }
            );
        },
        [],
    );

    return config;
}
