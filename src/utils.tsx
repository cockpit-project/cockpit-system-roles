/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2026 Red Hat, Inc.
 */

import React, { useState, useEffect } from 'react';

import { Button, ButtonProps } from '@patternfly/react-core/dist/esm/components/Button';
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput';
import { RhUiExternalLinkIcon } from '@patternfly/react-icons';
import { Tbody, Tr, TrProps, Td, ExpandableRowContent } from '@patternfly/react-table';

import { FileChooserInput, FileChooserProps } from 'cockpit/react/FileChooser';
import { useObject } from 'hooks';

export function shortenstart(prefix: string, val: string): string {
    if (val.startsWith(prefix))
        return val.substring(prefix.length);
    else
        return val;
}

export function JSON_parse_carefully(input: string, def?: unknown): unknown {
    try {
        return JSON.parse(input);
    } catch {
        return def;
    }
}

function same_typeof<T>(a: unknown, b: T): a is T {
    return typeof a === typeof b;
}

export function JSON_parse_type<T>(input: string, def: T): T {
    const v = JSON_parse_carefully(input);
    if (same_typeof(v, def))
        return v;
    else
        return def;
}

export const ExternalLinkButton = (props : ButtonProps) => (
    <Button
        component="a"
        icon={<RhUiExternalLinkIcon />}
        iconPosition="right"
        rel="noopener noreferrer"
        target="_blank"
        {...props}
    />
);

export const ExpandableTr = ({
    rowIndex,
    expandableContent,
    children,
    ...props
} : {
    rowIndex: number,
    expandableContent: React.ReactNode,
    children: React.ReactNode[],
} & Omit<TrProps, "children">) => {
    const [expanded, setExpanded] = useState<boolean>(false);

    return (
        <Tbody isExpanded={expanded}>
            <Tr {...props}>
                <Td
                    expand={
                        {
                            rowIndex,
                            isExpanded: expanded,
                            onToggle: () => {
                                setExpanded(!expanded);
                            }
                        }
                    }
                />
                { children }
            </Tr>
            <Tr isExpanded={expanded}>
                <Td colSpan={children.length + 1}>
                    <ExpandableRowContent>
                        { expandableContent }
                    </ExpandableRowContent>
                </Td>
            </Tr>
        </Tbody>
    );
};

class Debouncer {
    #timeout: number = 0;
    #func: (() => Promise<void>) | null = null;
    #promise: Promise<void> | null = null;

    static debouncers = new Set<Debouncer>();

    constructor() {
        Debouncer.debouncers.add(this);
    }

    destroy() {
        if (this.#timeout)
            window.clearTimeout(this.#timeout);
        Debouncer.debouncers.delete(this);
    }

    #start() {
        if (this.#func)
            this.#promise = this.#func().then(() => { this.#promise = null });
        this.#func = null;
    }

    trigger(delay: number, func: () => Promise<void>): void {
        if (this.#timeout)
            window.clearTimeout(this.#timeout);
        this.#func = func;
        this.#timeout = window.setTimeout(
            async () => {
                this.#timeout = 0;
                this.#start();
            },
            delay,
        );
    }

    async run_now () {
        if (this.#timeout)
            window.clearTimeout(this.#timeout);
        if (!this.#promise)
            this.#start();
        if (this.#promise)
            await this.#promise;
    }
}

export function useDebouncer() {
    return useObject(
        () => new Debouncer(),
        db => db.destroy(),
        [],
    );
}

export async function run_debouncers_now() {
    for (const db of Debouncer.debouncers.values())
        await db.run_now();
}

export const DebouncedTextInput = ({
    value,
    onChange,
    placeholder,
} : {
    value: string,
    onChange: (val: string) => Promise<void>,
    placeholder?: string,
}) => {
    const [localValue, setLocalValue] = useState<string>(value);
    const debouncer = useDebouncer();

    useEffect(
        () => {
            setLocalValue(value);
        },
        [value],
    );

    return (
        <TextInput
            value={localValue}
            onChange={
                (_event, val) => {
                    setLocalValue(val);
                    debouncer.trigger(500, () => onChange(val));
                }
            }
            {...placeholder ? { placeholder } : {}}
        />
    );
};

export const DebouncedFileChooserInput = ({
    value,
    onChange,
    fileChooserProps,
} : {
    value: string,
    onChange: (val: string) => Promise<void>,
    fileChooserProps: FileChooserProps,
}) => {
    const [localValue, setLocalValue] = useState<string>(value);
    const debouncer = useDebouncer();

    useEffect(
        () => {
            setLocalValue(value);
        },
        [value],
    );

    return (
        <FileChooserInput
            value={localValue}
            onChange={
                (val, fromDialog) => {
                    setLocalValue(val);
                    if (!fromDialog)
                        debouncer.trigger(500, () => onChange(val));
                    else
                        debouncer.trigger(0, () => onChange(val));
                }
            }
            fileChooserProps={fileChooserProps}
        />
    );
};
